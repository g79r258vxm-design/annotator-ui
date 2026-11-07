(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var IMG_W = 1440;
  var IMG_H = 1920;
  var BASE_TIER = 10;
  var TOTAL_FRAMES = 93;
  var FRAME_ID = 'P03_T02_20261101_T0830_0047';

  /* 设备唯一开关：特写站装好后只改这两行，其余全自动联动 */
  var CLOSEUP_STATUS = 'approved_pending_install';  /* 'not_planned' | 'approved_pending_install' | 'installed' */
  var CLOSEUP_PX_PER_CM = null;                     /* 特写站自身实测 px/cm；未接入为空，接入后填 ≥40 的实测值 */
  var CLOSEUP_MIN_PXCM = 40;

  /* 临时锁定维度：受标准未定或本帧条件限制，与设备无关 */
  var ALWAYS_LOCKED_DIMS = ['B2', 'C', 'CA', 'F', 'A1', 'A2', 'A3', 'A4', 'F3'];

  /* D/D2/D4 依赖特写站分辨率；B3 双依赖（特写站 + 白卡）；C4 只依赖白卡。
     注意：特写站是独立微距机位，分辨率必须用 CLOSEUP_PX_PER_CM 判，
     不能用宽幅主相机的 pxcm 代替——两者是不同光路，不可混用。 */
  function closeupResOk() {
    if (CLOSEUP_STATUS !== 'installed') return false;
    return typeof CLOSEUP_PX_PER_CM === 'number' && CLOSEUP_PX_PER_CM >= CLOSEUP_MIN_PXCM;
  }

  function provisionalLocked(colorCalibrated) {
    var resOk = closeupResOk();
    var locked = ALWAYS_LOCKED_DIMS.slice();
    if (!resOk) locked.push('D', 'D2', 'D4');
    if (!(resOk && colorCalibrated)) locked.push('B3');
    if (!colorCalibrated) locked.push('C4');
    return locked;
  }

  /* 设备能力的唯一来源：导出记录与 COCO info 都调用它，避免两处漂移 */
  function deviceCapability(pxcm, colorCalibrated) {
    var installed = CLOSEUP_STATUS === 'installed';
    var resOk = closeupResOk();
    var note;
    if (installed) {
      note = resOk
        ? '特写站已接入且微距档 ≥' + CLOSEUP_MIN_PXCM + ' px/cm：D/D2/D4 已解锁；B3 仍需白卡色彩标定'
        : '特写站已接入但微距档尚未标定或不足 ' + CLOSEUP_MIN_PXCM + ' px/cm：D/D2/D4 仍临时锁定';
    } else if (CLOSEUP_STATUS === 'approved_pending_install') {
      note = '特写站已批准采购但本帧尚未接入，D/B3 记 9 属临时锁定；接入后按 ≥' + CLOSEUP_MIN_PXCM + ' px/cm 自动解锁，不再是永久不可判';
    } else {
      note = '特写站未列入采购，D/B3 缺少 ≥' + CLOSEUP_MIN_PXCM + ' px/cm 微距条件，记 9 属长期锁定';
    }
    return {
      closeup_station: installed || CLOSEUP_STATUS === 'approved_pending_install',
      closeup_station_status: CLOSEUP_STATUS,
      closeup_px_per_cm: CLOSEUP_PX_PER_CM,
      required_px_per_cm: { D: CLOSEUP_MIN_PXCM, B3: CLOSEUP_MIN_PXCM },
      unlock_dependencies: { D: ['closeup_station'], B3: ['closeup_station', 'color_calib'] },
      cameras: {
        wide: { role: '群体与个体全景', required_for: ['A1', 'A2', 'B1', 'E1', 'E3', 'F1', 'G2'] },
        macro: {
          role: '内脏与鳃微距',
          required_for: ['D1', 'D2', 'D3', 'D4', 'D5', 'B3'],
          status: installed ? 'installed' : 'pending_install'
        }
      },
      dims_enabled: {
        D: resOk,
        D2: resOk,
        D4: resOk,
        B3: resOk && !!colorCalibrated,
        C4: !!colorCalibrated
      },
      max_px_per_cm: Number(pxcm.toFixed(2)),
      permanent_locked_dimensions: [],
      provisional_locked_dimensions: provisionalLocked(colorCalibrated),
      note: note
    };
  }

  /* ============ 本地多模态模型（LM Studio）配置 ============ */
  var VL_MODEL_ID = 'qwen/qwen3-vl-8b';
  var VL_BASE_URL = 'http://127.0.0.1:1234/v1';
  var VL_TIMEOUT_MS = 240000;   /* VLM 推理较重，留 4 分钟 */

  var $ = function (id) { return document.getElementById(id); };
  var toastEl = $('toast');
  var toastTimer = null;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  function el(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  /* ============ 状态：AI 预标注结果，可被人工改写 ============ */

  var state = {
    phase: 1,
    side: 100,
    corners: [
      { x: 184, y: 580 }, { x: 1290, y: 470 },
      { x: 1400, y: 1636 }, { x: 246, y: 1720 }
    ],
    school: [
      { x: 514, y: 1003 }, { x: 540, y: 909 }, { x: 649, y: 859 }, { x: 776, y: 844 },
      { x: 889, y: 885 }, { x: 983, y: 975 }, { x: 1005, y: 1116 }, { x: 968, y: 1253 },
      { x: 883, y: 1350 }, { x: 728, y: 1392 }, { x: 593, y: 1343 }, { x: 521, y: 1211 },
      { x: 503, y: 1097 }
    ],
    inst: [
      { id: 'I01', x: 300, y: 950, w: 130, h: 120, src: 'ai', a5: '1', a5explicit: false },
      { id: 'I03', x: 1150, y: 600, w: 117, h: 108, src: 'ai', a5: '1', a5explicit: false },
      { id: 'I05', x: 1185, y: 1320, w: 155, h: 99, src: 'ai', a5: '1', a5explicit: false }
    ],
    rope: [
      { x1: 702, y1: 100, x2: 200, y2: 600, src: 'ai' },
      { x1: 702, y1: 100, x2: 1290, y2: 480, src: 'ai' },
      { x1: 702, y1: 100, x2: 1380, y2: 1380, src: 'ai' }
    ],
    feed: [
      { id: 'BF01', x: 700, y: 640, src: 'ai' }, { id: 'BF02', x: 980, y: 700, src: 'ai' },
      { id: 'BF03', x: 430, y: 1120, src: 'ai' }, { id: 'BF04', x: 620, y: 1300, src: 'ai' },
      { id: 'BF05', x: 1050, y: 1180, src: 'ai' }, { id: 'BF06', x: 520, y: 830, src: 'ai' }
    ],
    /* 料台轮廓与几何标定（VLM 预标 + 用户确认） */
    trayOutline: null,      /* VLM 判的料台轮廓，格式 [[x,y], ...]，null 表示未识别 */
    trayShape: null,        /* 'square' | 'round' | null */
    trayMeta: {
      shape: null,          /* 用户确认：'square' | 'round' */
      realSizeCm: null,     /* 方形填边长cm，圆形填直径cm */
      pxPerCm: null         /* 标定后由 Corners → homography 计算得出 */
    },
    sel: null,
    edited: {},
    removed: [],
    reuse: null
  };

  var view = { z: 1, tx: 0, ty: 0 };
  var activeVert = null;
  var spaceHeld = false;

  var nextInst = 6;
  var nextMolt = 1;
  var nextDead = 1;
  var nextFeed = 7;
  var nextHeadShell = 1;
  var nextMeat = 1;
  var nextFeces = 1;

  /* 对象类型表：prefix 决定 id 前缀（与既有 I/M/X/BF/R/S/Q 不冲突），label 用于画布与 toast */
  var CLS_STYLE = {
    shrimp: { prefix: 'I', label: '虾个体' },
    molt: { prefix: 'M', label: '蜕壳' },
    dead: { prefix: 'X', label: '死亡个体' },
    head_shell: { prefix: 'HS', label: '头壳' },
    meat_fragment: { prefix: 'MF', label: '肉段' },
    feces: { prefix: 'FC', label: '粪块' }
  };

  /* 按类型取序号并自增（ES5 无引用类型，逐个判断避免嵌套三元） */
  function takeSeq(cls) {
    if (cls === 'molt') { nextMolt += 1; return nextMolt - 1; }
    if (cls === 'dead') { nextDead += 1; return nextDead - 1; }
    if (cls === 'head_shell') { nextHeadShell += 1; return nextHeadShell - 1; }
    if (cls === 'meat_fragment') { nextMeat += 1; return nextMeat - 1; }
    if (cls === 'feces') { nextFeces += 1; return nextFeces - 1; }
    nextInst += 1;
    return nextInst - 1;
  }

  /* ============ 几何换算 ============ */

  var stage = $('canvasStage');
  var roi = $('roiPoly');
  var zone = $('centerZone');
  var zoneLabel = $('zoneLabel');
  var sideInput = $('sideCm');
  var trayShapeSel = $('trayShapeSel');
  var sizeLabel = $('sizeLabel');
  var btnAlignTrayCorners = $('btnAlignTrayCorners');
  var pxcmOut = $('pxcmOut');
  var edgesOut = $('edgesOut');
  var chipPxcm = $('chipPxcm');
  var gatePx = $('gatePx');
  var gateEligible = $('gateEligible');
  var gateHint = $('gateHint');
  var metaBody = $('metaBody');
  var chipStable = $('chipStable');
  var chipEligible = $('chipEligible');
  var reasonCodes = $('reasonCodes');
  var reasonNote = $('reasonNote');
  var liStable = $('liStable');
  var liColor = $('liColor');
  var humanCount = $('humanCount');
  var objCount = $('objCount');
  var nineRatio = $('nineRatio');
  var objInfo = $('objInfo');
  var draftRect = $('draft');
  var ptGate = $('ptGate');
  var ptCount = $('ptCount');
  var ptNote = $('ptNote');
  var phaseChip = $('phaseChip');
  var mOcc = $('mOcc');
  var mEdgeN = $('mEdgeN');
  var mAspect = $('mAspect');
  var mOff = $('mOff');

  /* 素材 / 时间轴相关节点 */
  var frameImg = $('frameImg');
  var overlaySvg = $('overlay');
  var dimOut = $('dimOut');
  var framePosOut = $('framePosOut');
  var frameIdOut = document.querySelector('.frame-id');
  var chipFrameQ = $('chipFrameQ');
  var stageEmpty = $('stageEmpty');
  var stageWarn = $('stageWarn');
  var proofHint = $('proofHint');
  var tlTitle = $('tlTitle');
  var tlMeta = $('tlMeta');
  var tlFrames = $('tlFrames');
  var tlNote = $('tlNote');
  var fileInput = $('fileInput');

  var layerSchool = $('layerSchool');
  var layerTray = $('layerTray');
  var layerRope = $('layerRope');
  var layerInst = $('layerInst');
  var layerFeed = $('layerFeed');
  var layerQuad = $('layerQuad');

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function metrics() {
    var shape = trayShapeSel.value;   /* 'square' | 'round' */
    state.trayMeta.shape = shape;

    /* 读取物理尺寸输入 */
    var v = parseFloat(sideInput.value);
    var sizeOk = v >= 40 && v <= 200;
    if (sizeOk) state.side = v;
    var realCm = state.side || 100;

    if (shape === 'square') {
      var e = [
        dist(state.corners[0], state.corners[1]), dist(state.corners[1], state.corners[2]),
        dist(state.corners[2], state.corners[3]), dist(state.corners[3], state.corners[0])
      ];
      var pxcm = ((e[0] + e[2]) / 2) / realCm;
      state.trayMeta.pxPerCm = pxcm;
      return { edges: e, side: realCm, pxcm: pxcm, shape: shape, realCm: realCm };
    } else {
      /* 圆形：优先用 trayOutline（VLM 预标）的圆心+半径；
         如果没有 trayOutline 或 trayOutline 不是圆形格式，就用 Corners bbox 的短边做直径估算 */
      var radiusPx = null, center = null;
      if (state.trayOutline && state.trayOutline.length >= 3) {
        /* trayOutline 格式：圆形为 [[cx,cy], radius]，方形为 [[x,y],...] */
        var first = state.trayOutline[0];
        if (Array.isArray(first) && state.trayOutline.length === 2 && typeof state.trayOutline[1] === 'number') {
          /* [[cx,cy], radius] 格式 */
          center = { x: first[0], y: first[1] };
          radiusPx = state.trayOutline[1];
        } else {
          /* 多边形：取外接圆的圆心和半径 */
          var cx = 0, cy = 0;
          state.trayOutline.forEach(function (p) { cx += p[0]; cy += p[1]; });
          cx /= state.trayOutline.length; cy /= state.trayOutline.length;
          radiusPx = Math.max.apply(null, state.trayOutline.map(function (p) {
            return Math.hypot(p[0] - cx, p[1] - cy);
          }));
          center = { x: cx, y: cy };
        }
      } else {
        /* fallback：Corners bbox 估算 */
        var xs = state.corners.map(function (p) { return p.x; });
        var ys = state.corners.map(function (p) { return p.y; });
        var w = Math.max.apply(null, xs) - Math.min.apply(null, xs);
        var h = Math.max.apply(null, ys) - Math.min.apply(null, ys);
        radiusPx = Math.min(w, h) / 2;
        center = { x: (Math.max.apply(null, xs) + Math.min.apply(null, xs)) / 2,
                   y: (Math.max.apply(null, ys) + Math.min.apply(null, ys)) / 2 };
      }
      var diameterPx = radiusPx * 2;
      var pxcmRound = diameterPx / realCm;   /* realCm 此时是直径 cm */
      state.trayMeta.pxPerCm = pxcmRound;
      state.trayOutlineRound = { center: center, radius: radiusPx };
      /* edges 用于 edgesOut 显示：返回估算的周长像素 */
      return { edges: [diameterPx, diameterPx, diameterPx, diameterPx],
               side: realCm, pxcm: pxcmRound, shape: shape, realCm: realCm };
    }
  }

  /* 二期硬门：边缘区每一尾虾都必须有一次显式 A5 判定（蜕壳/死亡个体不计） */
  function perTail() {
    var edge = state.inst.filter(function (o) {
      return zoneOf(o) === 'edge' && (o.cls || 'shrimp') === 'shrimp';
    });
    var explicit = edge.filter(function (o) { return o.a5explicit; });
    return {
      total: edge.length,
      explicit: explicit.length,
      missing: edge.filter(function (o) { return !o.a5explicit; }).map(function (o) { return o.id; }),
      complete: edge.length > 0 && explicit.length === edge.length
    };
  }

  /* 衍生指标：右栏 E1/E3 由图上对象自动聚合，不做人工填写 */
  var HEAD_SHELL_COLORS = ['light', 'yellow', 'dark'];
  var COLOR_ALIAS = {
    light: 'light', yellow: 'yellow', dark: 'dark',
    '浅色': 'light', '发黄': 'yellow', '发黑': 'dark'
  };
  var COLOR_LABEL = { light: '浅色', yellow: '发黄', dark: '发黑' };

  function countCls(cls) {
    return state.inst.filter(function (o) { return (o.cls || 'shrimp') === cls; }).length;
  }

  function derivedMetrics() {
    var colorCounts = { light: 0, yellow: 0, dark: 0 };
    state.inst.forEach(function (o) {
      if ((o.cls || 'shrimp') !== 'head_shell') return;
      var c = o.attrs && o.attrs.color;
      var key = COLOR_ALIAS[c];
      if (key && colorCounts.hasOwnProperty(key)) colorCounts[key] += 1;
    });
    var mode = null;
    var best = 0;
    HEAD_SHELL_COLORS.forEach(function (k) {
      if (colorCounts[k] > best) { best = colorCounts[k]; mode = k; }
    });
    return {
      head_shell: { count: countCls('head_shell'), color_counts: colorCounts, color_mode: mode },
      meat_fragment: { count: countCls('meat_fragment') },
      dead_shrimp: { count: countCls('dead') },
      feces: { count: countCls('feces') },
      molt: { count: countCls('molt') },
      /* G2 病健比与对象计数同属"由标注派生"，放同一块便于下游一次取全 */
      g2_health: healthStats()
    };
  }

  /* G2 病健比：只由虾个体的 health 标签聚合，分子分母都用"已标尾数"，不拿可见总数当分母 */
  var HEALTH_LABEL = { healthy: '健康', subhealth: '亚健康', sick: '病虾' };

  /* G2 出比值的门槛。目前是工程默认值，规程未规定——专家确认后只改这两行，导出会同步带上 */
  var G2_MIN_LABELED = 10;
  var G2_MIN_COVERAGE = 0.6;

  function healthStats() {
    var shrimp = state.inst.filter(function (o) { return (o.cls || 'shrimp') === 'shrimp'; });
    var labeled = shrimp.filter(function (o) { return !!o.health; });
    var counts = { healthy: 0, subhealth: 0, sick: 0 };
    labeled.forEach(function (o) { if (counts.hasOwnProperty(o.health)) counts[o.health] += 1; });
    var visible = shrimp.length;
    var coverage = visible ? labeled.length / visible : 0;
    var enough = labeled.length >= G2_MIN_LABELED && coverage >= G2_MIN_COVERAGE;
    return {
      /* framed_total = 本帧已框出的虾个体数；不是画面真实可见总数，故不与画面总数混用 */
      framed_total: visible,
      labeled: labeled.length,
      coverage: Number(coverage.toFixed(3)),
      counts: counts,
      ratio: enough ? Number((counts.sick / labeled.length).toFixed(3)) : null,
      reason: enough ? null
        : (labeled.length < G2_MIN_LABELED ? 'insufficient_samples' : 'coverage_below_60pct'),
      /* 门槛随导出落盘，下游能看到这个比值是按什么条件成立的 */
      thresholds: {
        min_labeled: G2_MIN_LABELED,
        min_coverage: G2_MIN_COVERAGE,
        source: 'engineering_default_pending_expert_review'
      }
    };
  }

  /* 写入右栏 E1/E3/G2；元素缺失时跳过，避免早期渲染报错 */
  function renderDerived() {
    var d = derivedMetrics();
    var e1 = $('E1val');
    var e3 = $('E3val');
    if (e1) {
      e1.textContent = d.head_shell.count > 0
        ? '头壳 ' + d.head_shell.count + ' 个 · 主色 ' + (COLOR_LABEL[d.head_shell.color_mode] || '待录')
        : '本帧未标注头壳对象 → 9';
    }
    if (e3) {
      var total = d.dead_shrimp.count + d.meat_fragment.count;
      e3.textContent = total > 0
        ? '死虾 ' + d.dead_shrimp.count + ' · 肉段 ' + d.meat_fragment.count
        : '本帧未见死虾/肉段 → 9';
    }

    var g2 = $('G2val');
    if (g2) {
      var h = healthStats();
      if (h.ratio === null) {
        g2.textContent = (h.reason === 'coverage_below_60pct'
          ? '覆盖率不足 → 9（已标 ' + h.labeled + ' 尾 / 已框 ' + h.framed_total + ' 尾 · 覆盖率 ' +
            Math.round(h.coverage * 100) + '%）'
          : '样本不足 → 9（已标 ' + h.labeled + ' 尾 / 已框 ' + h.framed_total + ' 尾）');
      } else {
        g2.textContent = '病虾 ' + h.counts.sick + ' / 已标 ' + h.labeled + ' 尾 · 覆盖率 ' +
          Math.round(h.coverage * 100) + '% · G2 ' + h.ratio.toFixed(2);
      }
    }
  }

  /* 个体健康工具条：仅选中虾个体时显示，按钮高亮当前 health */
  function renderHealthBar() {
    var bar = $('healthBar');
    if (!bar) return;
    var hit = state.sel ? findObj(state.sel) : null;
    var o = hit && hit.kind === 'inst' ? hit.o : null;
    var show = !!(o && (o.cls || 'shrimp') === 'shrimp');
    bar.hidden = !show;
    Array.prototype.forEach.call(bar.querySelectorAll('.hb[data-health]'), function (b) {
      var v = b.getAttribute('data-health');
      if (show && v && o.health === v) b.classList.add('on');
      else b.classList.remove('on');
    });
  }

  /* 头壳/蜕壳颜色：E1"头壳发黄且多 → 蜕壳不遂"推理链的录入入口 */
  function renderColorBar() {
    var bar = $('colorBar');
    if (!bar) return;
    var hit = state.sel ? findObj(state.sel) : null;
    var o = hit && hit.kind === 'inst' ? hit.o : null;
    var cls = o ? (o.cls || 'shrimp') : '';
    var show = !!(o && (cls === 'head_shell' || cls === 'molt'));
    bar.hidden = !show;
    var cur = show && o.attrs ? o.attrs.color : null;
    Array.prototype.forEach.call(bar.querySelectorAll('.hb[data-color]'), function (b) {
      var v = b.getAttribute('data-color');
      if (show && v && cur === v) b.classList.add('on');
      else b.classList.remove('on');
    });
  }

  function toImage(clientX, clientY) {
    var box = stage.getBoundingClientRect();
    var scale = Math.min(box.width / IMG_W, box.height / IMG_H);
    var ox = box.left + (box.width - IMG_W * scale) / 2;
    var oy = box.top + (box.height - IMG_H * scale) / 2;
    return { x: (clientX - ox) / scale, y: (clientY - oy) / scale };
  }

  function clampPt(p) {
    return {
      x: Math.max(0, Math.min(IMG_W, p.x)),
      y: Math.max(0, Math.min(IMG_H, p.y))
    };
  }

  function applyView() {
    stage.style.transform = 'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + view.z + ')';
    $('zoomOut').textContent = view.z.toFixed(1) + '×';
  }

  function zoomAt(clientX, clientY, factor) {
    var host = stage.parentElement.getBoundingClientRect();
    var z2 = Math.min(10, Math.max(0.5, view.z * factor));
    if (z2 === view.z) return;
    var mx = clientX - host.left;
    var my = clientY - host.top;
    view.tx = mx - (mx - view.tx) * (z2 / view.z);
    view.ty = my - (my - view.ty) * (z2 / view.z);
    view.z = z2;
    applyView();
  }

  function centroid() {
    var s = state.corners.reduce(function (a, p) { return { x: a.x + p.x, y: a.y + p.y }; }, { x: 0, y: 0 });
    return { x: s.x / 4, y: s.y / 4 };
  }

  function markEdit(id) {
    state.edited[id] = 1;
  }

  function segDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1);
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function insertSchoolVertex(p) {
    var best = 0, bestD = Infinity;
    state.school.forEach(function (a, i) {
      var b = state.school[(i + 1) % state.school.length];
      var d = segDist(p, a, b);
      if (d < bestD) { bestD = d; best = i; }
    });
    state.school.splice(best + 1, 0, { x: Math.round(p.x), y: Math.round(p.y) });
  }

  /* 中央区 ∅50cm 内不逐尾，仅记录位置（计数为 false） */
  function zoneOf(o) {
    var c = centroid();
    var r = 25 * metrics().pxcm;
    var cx = o.x + o.w / 2;
    var cy = o.y + o.h / 2;
    return Math.hypot(cx - c.x, cy - c.y) <= r ? 'center' : 'edge';
  }

  function totalHuman() {
    return Object.keys(state.edited).length;
  }

  /* ============ 渲染 ============ */

  function render() {
    var m = metrics();
    var i;

    roi.setAttribute('points', state.corners.map(function (p) {
      return Math.round(p.x) + ',' + Math.round(p.y);
    }).join(' '));

    var c = centroid();
    var r = 25 * m.pxcm;
    zone.setAttribute('cx', Math.round(c.x));
    zone.setAttribute('cy', Math.round(c.y));
    zone.setAttribute('r', Math.round(r));
    zoneLabel.setAttribute('x', Math.round(c.x));
    zoneLabel.setAttribute('y', Math.round(c.y - r - 24));

    layerQuad.textContent = '';
    state.corners.forEach(function (p, k) {
      var g = el('g', { 'class': 'quad', 'data-q': k });
      g.appendChild(el('circle', { 'class': 'hit', cx: p.x, cy: p.y, r: 40 }));
      g.appendChild(el('circle', { 'class': 'dot', cx: p.x, cy: p.y, r: 13 }));
      var end = k === 2;
      var t = el('text', { x: end ? p.x - 22 : p.x + 22, y: p.y - 16 });
      if (end) t.setAttribute('text-anchor', 'end');
      t.textContent = 'Q' + (k + 1);
      g.appendChild(t);
      layerQuad.appendChild(g);
    });

    layerSchool.textContent = '';
    var poly = el('polygon', {
      'class': 'school' + (state.sel === 'S01' ? ' sel' : ''),
      'data-id': 'S01',
      points: state.school.map(function (p) { return Math.round(p.x) + ',' + Math.round(p.y); }).join(' ')
    });
    layerSchool.appendChild(poly);
    var vg = el('g', {});
    state.school.forEach(function (p, k) {
      vg.appendChild(el('circle', { 'class': 'vert', 'data-vi': k, cx: p.x, cy: p.y, r: 17 }));
    });
    layerSchool.appendChild(vg);

    /* 料台轮廓覆盖层（VLM 预标，低置信度） */
    layerTray.textContent = '';
    if (state.trayOutline && state.trayOutline.length >= 3) {
      var trayPts = state.trayOutline.map(function (p) { return Math.round(p[0]) + ',' + Math.round(p[1]); }).join(' ');
      var trayPoly = el('polygon', {
        class: 'tray-outline-lowconf',
        points: trayPts,
        fill: 'rgba(255,180,0,0.10)',
        stroke: '#ff9900',
        'stroke-width': 4,
        'stroke-dasharray': '10 6',
        opacity: 0.85
      });
      layerTray.appendChild(trayPoly);
      var trayLabel = el('text', {
        x: Math.round(state.trayOutline[0][0]) + 8,
        y: Math.round(state.trayOutline[0][1]) - 10,
        fill: '#ff9900',
        'font-size': 22,
        'font-weight': 'bold',
        opacity: 0.9
      });
      trayLabel.textContent = 'AI 料台轮廓（' + (state.trayShape || '?') + '）· 侧栏可录入物理尺寸做 px/cm 标定';
      layerTray.appendChild(trayLabel);
    }

    layerInst.textContent = '';
    state.inst.forEach(function (o) {
      var zn = zoneOf(o);
      var cls = o.cls || 'shrimp';
      var needTail = state.phase === 2 && zn === 'edge' && !o.a5explicit && cls === 'shrimp';
      var g = el('g', {
        'class': 'inst' + (state.sel === o.id ? ' sel' : '') +
          (zn === 'center' ? ' zone-center' : '') + (needTail ? ' need-tail' : '') +
          (cls !== 'shrimp' ? ' cls-' + cls : ''),
        'data-id': o.id
      });
      g.appendChild(el('rect', { x: o.x, y: o.y, width: o.w, height: o.h }));
      var t = el('text', { x: o.x + 8, y: o.y - 14 });
      var clsInfo = CLS_STYLE[cls];
      t.textContent = o.id + (clsInfo && cls !== 'shrimp' ? ' · ' + clsInfo.label : '') +
        (zn === 'center' && cls === 'shrimp' ? ' · 不计' : '') +
        (cls === 'shrimp' ? ' · A5 ' + (o.a5 || '9') : '') +
        (needTail ? ' · 待逐尾' : '');
      g.appendChild(t);
      if (state.sel === o.id) {
        [[o.x, o.y, 'nw'], [o.x + o.w, o.y, 'ne'], [o.x + o.w, o.y + o.h, 'se'], [o.x, o.y + o.h, 'sw']]
          .forEach(function (h) {
            g.appendChild(el('rect', {
              'class': 'h', 'data-handle': h[2],
              x: h[0] - 12, y: h[1] - 12, width: 24, height: 24
            }));
          });
      }
      layerInst.appendChild(g);
    });

    layerFeed.textContent = '';
    state.feed.forEach(function (o) {
      var isLC = o.lowConfidence;
      var g = el('g', {
        'class': 'feed' + (isLC ? ' lowconf' : '') + (state.sel === o.id ? ' sel' : ''),
        'data-id': o.id,
        opacity: isLC ? 0.75 : 1
      });
      /* 低置信度的 AI 预标：额外画一个大虚线圈提示待确认 */
      if (isLC) {
        g.appendChild(el('circle', {
          cx: o.x, cy: o.y, r: 22,
          fill: 'none', stroke: '#ff3333', 'stroke-width': 2.5,
          'stroke-dasharray': '6 4', opacity: 0.85
        }));
      }
      g.appendChild(el('path', {
        d: 'M' + (o.x - 12) + ' ' + o.y + 'h24M' + o.x + ' ' + (o.y - 12) + 'v24',
        stroke: isLC ? '#ff3333' : null
      }));
      layerFeed.appendChild(g);
    });

    layerRope.textContent = '';
    state.rope.forEach(function (r, k) {
      var id = 'R0' + (k + 1);
      var g = el('g', { 'class': 'ropegrp', 'data-id': id });
      g.appendChild(el('path', { 'class': 'rope' + (state.sel === id ? ' sel' : ''),
        d: 'M' + r.x1 + ' ' + r.y1 + ' L' + r.x2 + ' ' + r.y2 }));
      g.appendChild(el('circle', { 'class': 'ropend', 'data-rk': k + ':0', cx: r.x1, cy: r.y1, r: 16 }));
      g.appendChild(el('circle', { 'class': 'ropend', 'data-rk': k + ':1', cx: r.x2, cy: r.y2, r: 16 }));
      layerRope.appendChild(g);
    });

    var ok = m.pxcm >= BASE_TIER;
    pxcmOut.textContent = m.pxcm.toFixed(1);
    edgesOut.textContent = m.edges.map(function (v) { return Math.round(v); }).join(' / ');
    chipPxcm.className = 'chip ' + (ok ? 'ok' : 'bad');
    chipPxcm.textContent = 'px/cm ' + m.pxcm.toFixed(1) + (ok ? ' · 达标' : ' · 未达档');
    gatePx.className = ok ? 'ok' : 'bad';
    gatePx.textContent = m.pxcm.toFixed(1) + (ok ? ' ≥ ' : ' < ') + BASE_TIER;

    var gs = gateState(m);
    gateEligible.className = gs.eligible ? 'ok' : 'bad';
    gateEligible.textContent = gs.eligible
      ? (gs.color_calibrated ? '是 · 可进训练集' : '是 · 仅几何/计数类')
      : '否 · 仅审计';
    gateHint.textContent = gs.reason_codes.length
      ? '阻断/警告：' + gs.reason_codes.join(' · ')
      : '固定机位、稳定期、采样率三项均满足，可进训练集';

    chipStable.className = 'chip ' + (gs.meta.stable_window_s >= STABLE_MIN_S ? 'ok' : 'bad');
    chipStable.textContent = '稳定窗 ' + gs.meta.stable_window_s.toFixed(1) + ' s';
    chipEligible.className = 'chip ' + (gs.eligible ? 'ok' : 'bad');
    chipEligible.textContent = gs.eligible ? '资格 通过' : '资格 剔除';

    reasonCodes.textContent = '';
    (gs.reason_codes.length ? gs.reason_codes : ['NONE']).forEach(function (c) {
      var s = document.createElement('span');
      s.className = 'code';
      s.textContent = c;
      reasonCodes.appendChild(s);
    });
    reasonNote.textContent = gs.eligible
      ? ('已过判读资格：' + (gs.color_calibrated ? '可进训练集' : '仅几何/计数类可进训练集，颜色类记 9'))
      : ('四角校准后 ' + m.pxcm.toFixed(1) + ' px/cm；' + gs.block.join('、') + ' 未过，本帧仅可作审计样本');

    liStable.className = gs.meta.stable_window_s >= STABLE_MIN_S ? '' : 'fail';
    liStable.innerHTML = '<b>' + (gs.meta.stable_window_s >= STABLE_MIN_S ? 'ok' : '×') +
      '</b>稳定窗 ' + gs.meta.stable_window_s.toFixed(1) + ' s' +
      (gs.meta.stable_window_s >= STABLE_REF_S ? ' ≥ 5 s' : ' < 5 s');
    liColor.className = gs.color_calibrated ? '' : 'fail';
    liColor.innerHTML = '<b>' + (gs.color_calibrated ? 'ok' : '×') + '</b>色彩标定' +
      (gs.color_calibrated ? ' ΔE00 达标' : ' 未通过');

    var total = 4 + 1 + 3 + state.inst.length + state.feed.length;
    objCount.textContent = total;
    humanCount.textContent = totalHuman() + ' / ' + total;
    /* I 类目只计虾个体；蜕壳/死亡/头壳/肉段/粪块不计入个体数 */
    document.querySelector('.cat[data-key="I"] .n').textContent =
      state.inst.filter(function (o) { return (o.cls || 'shrimp') === 'shrimp'; }).length;
    document.querySelector('.cat[data-key="BF"] .n').textContent = state.feed.length;

    var labs = readLabels();
    var keys = Object.keys(labs);
    var nines = keys.filter(function (k) {
      var v = String(labs[k]);
      return v === '9' || /\d+=?9$/.test(v) || v === 'P9';
    }).length;
    var pct = keys.length ? Math.round(nines / keys.length * 100) : 0;
    nineRatio.textContent = pct + '% · ' + nines + '/' + keys.length;
    nineRatio.className = pct >= 50 ? 'warn' : '';
    nineRatio.title = '单帧 9 类（不可判）占比。规程 8.x：批次内连续两周 >15% 应暂停标注并回查采集';

    /* 阶段与逐尾硬门 */
    phaseChip.textContent = state.phase === 1 ? '一期 · 群体级真值' : '二期 · 逐尾强制';
    phaseChip.className = 'chip' + (state.phase === 2 ? ' bad' : '');
    var pt = perTail();
    ptCount.textContent = pt.explicit + ' / ' + pt.total;
    ptGate.className = 'ptgate' +
      (state.phase === 2 ? (pt.complete ? ' ok' : ' block') : '');
    ptNote.textContent = state.phase === 2
      ? (pt.complete ? '二期硬门已满足，可导出' : '二期硬门：未逐尾不得导出 · 缺 ' + pt.missing.join('、'))
      : '一期：未逐尾用帧级代理，可导出';

    /* 群体指标 §8.9：全部由分割与实例结果计算，不依赖逐尾计数 */
    var trayArea = schoolArea(state.corners);
    var cluArea = schoolArea(state.school);
    mOcc.textContent = trayArea ? (cluArea / trayArea * 100).toFixed(0) + '%' : '—';
    var edgeN = state.inst.filter(function (o) {
      return zoneOf(o) === 'edge' && (o.cls || 'shrimp') === 'shrimp';
    }).length;
    mEdgeN.textContent = edgeN + ' 尾';
    var aspect = clusterAspect(state.school);
    mAspect.textContent = aspect ? aspect.toFixed(2) + ' : 1' : '—';
    mOff.textContent = clusterOffsetCm(state.school, centroid(), m.pxcm).toFixed(1) + ' cm';

    renderObjInfo();
    renderDerived();
    renderHealthBar();
    renderColorBar();
    updateWizard(m);
    return m;
  }

  function renderObjInfo() {
    var label = '未选中';
    var hint = '点选图上对象；方向键 1 px 微调，Shift+方向键 10 px；滚轮缩放，空格拖拽平移';

    if (state.sel === 'S01') {
      label = 'S01 · 虾群分割 · ' + state.school.length + ' 顶点';
      hint = '拖顶点改单个点，拖内部整体平移；Alt+点轮廓加顶点，Alt+点顶点删顶点';
    } else if (state.sel && /^Q[1-4]$/.test(state.sel)) {
      var qi = Number(state.sel.slice(1)) - 1;
      label = state.sel + ' · 料台角点 · (' + Math.round(state.corners[qi].x) + ', ' + Math.round(state.corners[qi].y) + ')';
      hint = '拖动改角点；四条边与 px/cm 实时重算，方向键可 1 px 微调';
    } else if (state.sel && state.sel.indexOf('R0') === 0) {
      label = state.sel + ' · 提绳掩膜 · ignore';
      hint = '拖端点改单段，拖线身整体平移；此区域不计入任何判据';
    } else if (activeVert !== null) {
      label = 'S01 顶点 V' + (activeVert + 1) + ' · 可方向键微调';
      hint = '单点坐标 (' + Math.round(state.school[activeVert].x) + ', ' + Math.round(state.school[activeVert].y) + ')';
    } else {
      var hit = state.sel ? findObj(state.sel) : null;
      if (hit && hit.kind === 'inst') {
        var zn = zoneOf(hit.o);
        label = hit.o.id + ' · 个体 · ' + (zn === 'edge' ? '边缘区·计入' : '中央区·不计') +
          ' · A5 ' + (hit.o.a5 || '9') + (hit.o.a5explicit ? '（逐尾）' : '（代理）');
        hint = hit.o.a5explicit
          ? '已写逐尾判据；拖框移动，拖四角手柄缩放'
          : '选中后点 A5 判据即写到这一尾；未写时用帧级代理值（二期硬门要求逐尾）';
      } else if (hit && hit.kind === 'feed') {
        label = hit.o.id + ' · 残饵点';
        hint = '拖动改位置；Delete 删除（记入误检审计）';
      }
    }
    objInfo.querySelector('.oi-row b').textContent = label;
    objInfo.querySelector('.oi-hint').textContent = hint;
  }

  /* ============ 撤销（整状态快照） ============ */

  var history = [];

  function snapshot() {
    history.push(JSON.stringify(state));
    if (history.length > 60) history.shift();
  }

  function undo() {
    var prev = history.pop();
    if (!prev) { toast('没有可撤销的操作'); return; }
    var s = JSON.parse(prev);
    state.corners = s.corners;
    state.school = s.school;
    state.inst = s.inst;
    state.feed = s.feed;
    state.rope = s.rope;
    state.sel = s.sel;
    state.edited = s.edited;
    state.removed = s.removed || [];
    state.reuse = s.reuse || null;
    activeVert = null;
    render();
    toast('已撤销上一步修改');
  }

  /* ============ 指针交互 ============ */

  var drag = null;
  var activeTool = 'select';

  function findObj(id) {
    for (var i = 0; i < state.inst.length; i++) {
      if (state.inst[i].id === id) return { kind: 'inst', o: state.inst[i] };
    }
    for (var j = 0; j < state.feed.length; j++) {
      if (state.feed[j].id === id) return { kind: 'feed', o: state.feed[j] };
    }
    if (id === 'S01') return { kind: 'school' };
    return null;
  }

  stage.addEventListener('pointerdown', function (e) {
    if (e.button === 1 || spaceHeld) {
      e.preventDefault();
      stage.setPointerCapture(e.pointerId);
      drag = { kind: 'pan', cx: e.clientX, cy: e.clientY, tx: view.tx, ty: view.ty };
      stage.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    var p = toImage(e.clientX, e.clientY);
    var hEl = e.target.closest ? e.target.closest('[data-handle]') : null;
    var vEl = e.target.closest ? e.target.closest('[data-vi]') : null;
    var rEl = e.target.closest ? e.target.closest('[data-rk]') : null;
    var qEl = e.target.closest ? e.target.closest('[data-q]') : null;
    var idEl = e.target.closest ? e.target.closest('[data-id]') : null;

    activeVert = null;
    stage.setPointerCapture(e.pointerId);

    /* Alt：点击顶点=删除，点击虾群轮廓=在该处插入顶点 */
    if (e.altKey) {
      if (vEl) {
        if (state.school.length <= 3) { toast('虾群轮廓至少保留 3 个顶点'); return; }
        snapshot();
        markEdit('S01');
        state.school.splice(Number(vEl.getAttribute('data-vi')), 1);
        state.sel = 'S01';
        render();
        toast('已删除 1 个顶点 · 剩 ' + state.school.length + ' 个');
        return;
      }
      if (idEl && idEl.getAttribute('data-id') === 'S01') {
        snapshot();
        markEdit('S01');
        insertSchoolVertex(p);
        state.sel = 'S01';
        render();
        toast('已插入顶点 · 共 ' + state.school.length + ' 个');
        return;
      }
    }

    if (hEl && idEl) {
      var box = state.inst.filter(function (o) { return o.id === idEl.getAttribute('data-id'); })[0];
      if (!box) return;
      snapshot();
      markEdit(box.id);
      drag = { kind: 'resize', o: box, handle: hEl.getAttribute('data-handle') };
      return;
    }

    if (vEl) {
      snapshot();
      markEdit('S01');
      state.sel = 'S01';
      drag = { kind: 'vert', i: Number(vEl.getAttribute('data-vi')) };
      activeVert = drag.i;
      render();
      return;
    }

    if (rEl) {
      var rk = rEl.getAttribute('data-rk').split(':');
      var ri = Number(rk[0]);
      snapshot();
      markEdit('R0' + (ri + 1));
      state.sel = 'R0' + (ri + 1);
      drag = { kind: 'ropept', ri: ri, which: Number(rk[1]) };
      render();
      return;
    }

    if (idEl && idEl.getAttribute('data-id').indexOf('R0') === 0) {
      var rid = idEl.getAttribute('data-id');
      var r2 = Number(rid.slice(1)) - 1;
      var seg = state.rope[r2];
      snapshot();
      markEdit(rid);
      state.sel = rid;
      drag = { kind: 'rope', ri: r2, ox: p.x, oy: p.y,
        orig: { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 } };
      render();
      return;
    }

    if (qEl) {
      snapshot();
      var k = Number(qEl.getAttribute('data-q'));
      markEdit('Q' + (k + 1));
      state.sel = 'Q' + (k + 1);
      drag = { kind: 'corner', i: k };
      return;
    }

    if (idEl) {
      var hit = findObj(idEl.getAttribute('data-id'));
      if (!hit) return;
      state.sel = idEl.getAttribute('data-id');
      snapshot();
      markEdit(state.sel);
      if (hit.kind === 'inst') {
        drag = { kind: 'move', o: hit.o, dx: p.x - hit.o.x, dy: p.y - hit.o.y, group: state.inst };
      } else if (hit.kind === 'feed') {
        drag = { kind: 'move', o: hit.o, dx: p.x - hit.o.x, dy: p.y - hit.o.y, group: state.feed };
      } else if (hit.kind === 'school') {
        drag = { kind: 'school', ox: p.x, oy: p.y, orig: state.school.map(function (q) { return { x: q.x, y: q.y }; }) };
      }
      render();
      return;
    }

    if (activeTool === 'box') {
      drag = { kind: 'newbox', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      draftRect.setAttribute('visibility', 'visible');
      return;
    }

    if (activeTool === 'point') {
      snapshot();
      var np = { id: 'BF' + (nextFeed < 10 ? '0' : '') + nextFeed, x: Math.round(p.x), y: Math.round(p.y), src: 'human' };
      nextFeed++;
      state.feed.push(np);
      state.sel = np.id;
      state.edited[np.id] = 1;
      render();
      toast('新增残饵点 ' + np.id + ' · 人工标注');
      return;
    }

    state.sel = null;
    render();
  });

  stage.addEventListener('pointermove', function (e) {
    if (!drag) return;

    if (drag.kind === 'pan') {
      view.tx = drag.tx + (e.clientX - drag.cx);
      view.ty = drag.ty + (e.clientY - drag.cy);
      applyView();
      return;
    }

    var p = toImage(e.clientX, e.clientY);

    if (drag.kind === 'corner') {
      state.corners[drag.i] = clampPt(p);
      render();
      return;
    }

    if (drag.kind === 'vert') {
      state.school[drag.i] = clampPt(p);
      render();
      return;
    }

    if (drag.kind === 'ropept') {
      var seg = state.rope[drag.ri];
      if (drag.which === 0) { seg.x1 = Math.round(p.x); seg.y1 = Math.round(p.y); }
      else { seg.x2 = Math.round(p.x); seg.y2 = Math.round(p.y); }
      render();
      return;
    }

    if (drag.kind === 'rope') {
      var s = state.rope[drag.ri];
      var dx = p.x - drag.ox;
      var dy = p.y - drag.oy;
      s.x1 = Math.round(drag.orig.x1 + dx);
      s.y1 = Math.round(drag.orig.y1 + dy);
      s.x2 = Math.round(drag.orig.x2 + dx);
      s.y2 = Math.round(drag.orig.y2 + dy);
      render();
      return;
    }

    if (drag.kind === 'move') {
      drag.o.x = Math.round(p.x - drag.dx);
      drag.o.y = Math.round(p.y - drag.dy);
      render();
      return;
    }

    if (drag.kind === 'school') {
      var dx = p.x - drag.ox;
      var dy = p.y - drag.oy;
      state.school = drag.orig.map(function (q) { return { x: q.x + dx, y: q.y + dy }; });
      render();
      return;
    }

    if (drag.kind === 'resize') {
      var o = drag.o;
      var right = o.x + o.w;
      var bottom = o.y + o.h;
      if (drag.handle.indexOf('w') >= 0) o.x = Math.min(p.x, right - 24);
      if (drag.handle.indexOf('e') >= 0) right = Math.max(p.x, o.x + 24);
      if (drag.handle.indexOf('n') >= 0) o.y = Math.min(p.y, bottom - 24);
      if (drag.handle.indexOf('s') >= 0) bottom = Math.max(p.y, o.y + 24);
      o.w = right - o.x;
      o.h = bottom - o.y;
      render();
      return;
    }

    if (drag.kind === 'newbox') {
      drag.x1 = p.x;
      drag.y1 = p.y;
      var x = Math.min(drag.x0, drag.x1);
      var y = Math.min(drag.y0, drag.y1);
      draftRect.setAttribute('x', x);
      draftRect.setAttribute('y', y);
      draftRect.setAttribute('width', Math.abs(drag.x1 - drag.x0));
      draftRect.setAttribute('height', Math.abs(drag.y1 - drag.y0));
    }
  });

  stage.addEventListener('pointerup', function () {
    if (!drag) return;
    var wasPan = drag.kind === 'pan';
    if (drag.kind === 'newbox') {
      var x = Math.min(drag.x0, drag.x1);
      var y = Math.min(drag.y0, drag.y1);
      var w = Math.abs(drag.x1 - drag.x0);
      var h = Math.abs(drag.y1 - drag.y0);
      draftRect.setAttribute('visibility', 'hidden');
      if (w >= 40 && h >= 40) {
        snapshot();
        var cls = $('boxClass').value;
        var style = CLS_STYLE[cls] || CLS_STYLE.shrimp;
        if (!CLS_STYLE[cls]) cls = 'shrimp';
        var seq = takeSeq(cls);
        var id = style.prefix + (seq < 10 ? '0' : '') + seq;
        state.inst.push({ id: id, cls: cls, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
          src: 'human', a5: '9', a5explicit: false });
        state.sel = id;
        state.edited[id] = 1;
        render();
        var zn = zoneOf(state.inst[state.inst.length - 1]);
        if (cls !== 'shrimp') {
          toast('新增' + style.label + ' ' + id + ' · 人工标注');
        } else {
          toast('新增个体 ' + id + (zn === 'center' ? ' · 中央区不计入密度' : ' · 请补 A5 尾肢判据'));
        }
      } else {
        render();
      }
    } else if (drag.kind === 'corner') {
      toast('Q' + (drag.i + 1) + ' 已校准 · px/cm ' + metrics().pxcm.toFixed(1));
    }
    drag = null;
    if (wasPan) activateTool(activeTool);
  });

  stage.addEventListener('pointercancel', function () {
    drag = null;
    draftRect.setAttribute('visibility', 'hidden');
    activateTool(activeTool);
  });

  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.25 : 0.8);
  }, { passive: false });

  sideInput.addEventListener('input', render);
  sideInput.addEventListener('change', function () {
    var v = parseFloat(sideInput.value);
    if (v >= 40 && v <= 200) {
      state.side = v;
      toast('料台边长按实测填写：' + v + ' cm · px/cm 与全部档位已重算');
    } else {
      sideInput.value = state.side;
      toast('边长须在 40–200 cm；已还原为 ' + state.side + ' cm');
      render();
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-side]'), function (b) {
    b.addEventListener('click', function () {
      sideInput.value = b.getAttribute('data-side');
      render();
      toast('料台尺寸按实测填写：' + state.side + ' cm · px/cm 与全部档位已重算');
    });
  });

  trayShapeSel.addEventListener('change', function () {
    var isRound = trayShapeSel.value === 'round';
    sizeLabel.textContent = isRound ? '直径' : '边长';
    state.trayMeta.shape = trayShapeSel.value;
    render();
    toast('料台形状已切换为「' + (isRound ? '圆形' : '方形') + '」· px/cm 已重算');
  });

  btnAlignTrayCorners.addEventListener('click', function () {
    if (!state.trayOutline || state.trayOutline.length < 3) {
      toast('AI 尚未识别料台轮廓 · 请先点击「AI 预标注」或手动在画面上定位料台四角');
      return;
    }
    /* 圆形 trayOutline 不直接映射到 Corners，因为 Corners 是 4 点结构 */
    if (trayShapeSel.value === 'round') {
      toast('圆形料台不需要对齐 Corners（Corners 仅用于方形）· 圆形会自动用 trayOutline 的半径算 px/cm');
      return;
    }
    /* 形状匹配 + trayOutline 不是圆形格式，复制到 Corners */
    var first = state.trayOutline[0];
    if (Array.isArray(first) && state.trayOutline.length === 2 && typeof state.trayOutline[1] === 'number') {
      toast('trayOutline 是圆形格式，不能映射到方形 Corners');
      return;
    }
    snapshot();   /* 可撤销 */
    state.corners = state.trayOutline.slice(0, 4).map(function (p) {
      return { x: Math.round(p[0]), y: Math.round(p[1]) };
    });
    state.trayMeta.shape = 'square';
    trayShapeSel.value = 'square';
    sizeLabel.textContent = '边长';
    render();
    toast('AI 预标料台轮廓已复制为 Corners · px/cm 已重算 · ⌘Z 可撤销');
  });

  Array.prototype.forEach.call(document.querySelectorAll('#phaseTog button'), function (b) {
    b.addEventListener('click', function () {
      state.phase = Number(b.getAttribute('data-phase'));
      Array.prototype.forEach.call(document.querySelectorAll('#phaseTog button'), function (x) {
        x.classList.toggle('on', x === b);
      });
      render();
      toast(state.phase === 1
        ? '一期：未逐尾用帧级代理，可导出'
        : '二期：逐尾强制，未逐尾不得导出');
    });
  });

  /* ============ 工具轨 ============ */

  var TOOL_KEYS = { v: 'select', q: 'quad', p: 'poly', b: 'brush', r: 'box', k: 'point' };
  var tools = Array.prototype.slice.call(document.querySelectorAll('.tool'));

  function activateTool(name) {
    activeTool = name;
    tools.forEach(function (t) {
      if (t.dataset.tool === 'undo') return;
      t.classList.toggle('active', t.dataset.tool === name);
    });
    stage.style.cursor = name === 'box' || name === 'point' ? 'crosshair' : 'default';
  }

  tools.forEach(function (t) {
    t.addEventListener('click', function () {
      if (t.dataset.tool === 'undo') { undo(); return; }
      activateTool(t.dataset.tool);
    });
  });

  var ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      spaceHeld = true;
      if (!drag) stage.style.cursor = 'grab';
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteSelected();
      return;
    }
    if (e.key === '0') {
      view.z = 1; view.tx = 0; view.ty = 0;
      applyView();
      toast('视图复位 1.0×');
      return;
    }
    if (ARROWS[e.key]) {
      e.preventDefault();
      var st = e.shiftKey ? 10 : 1;
      nudge(ARROWS[e.key][0] * st, ARROWS[e.key][1] * st);
      return;
    }
    var name = TOOL_KEYS[e.key.toLowerCase()];
    if (name) activateTool(name);
  });

  document.addEventListener('keyup', function (e) {
    if (e.code === 'Space' && spaceHeld) {
      spaceHeld = false;
      if (!drag) activateTool(activeTool);
    }
  });

  /* 方向键微调：优先作用于最近选中的顶点，其次作用于选中对象 */
  function nudge(dx, dy) {
    if (activeVert !== null && state.school[activeVert]) {
      snapshot();
      markEdit('S01');
      state.school[activeVert] = clampPt({
        x: state.school[activeVert].x + dx, y: state.school[activeVert].y + dy
      });
      render();
      return;
    }
    var sel = state.sel;
    if (!sel) { toast('先选中顶点或对象再微调'); return; }
    snapshot();
    if (sel === 'S01') {
      markEdit('S01');
      state.school = state.school.map(function (p) { return { x: p.x + dx, y: p.y + dy }; });
    } else if (sel.indexOf('Q') === 0 && /^Q[1-4]$/.test(sel)) {
      markEdit(sel);
      state.corners[Number(sel.slice(1)) - 1] = clampPt({
        x: state.corners[Number(sel.slice(1)) - 1].x + dx,
        y: state.corners[Number(sel.slice(1)) - 1].y + dy
      });
    } else if (sel.indexOf('R0') === 0) {
      markEdit(sel);
      var r = state.rope[Number(sel.slice(1)) - 1];
      r.x1 += dx; r.y1 += dy; r.x2 += dx; r.y2 += dy;
    } else {
      var hit = findObj(sel);
      if (!hit) { toast('该对象不支持微调'); return; }
      markEdit(sel);
      if (hit.kind === 'inst') { hit.o.x += dx; hit.o.y += dy; }
      else if (hit.kind === 'feed') { hit.o.x += dx; hit.o.y += dy; }
    }
    render();
  }

  function deleteSelected() {
    if (!state.sel) { toast('先点选一个对象'); return; }
    if (state.sel === 'S01') { toast('虾群分割不可删除，请拖动蓝色顶点重描'); return; }
    if (state.sel.indexOf('R0') === 0) { toast('提绳掩膜不可删除，请拖动端点校正'); return; }
    if (/^Q[1-4]$/.test(state.sel)) { toast('料台四角为标定基准，不可删除'); return; }
    snapshot();
    var hit = findObj(state.sel);
    if (hit && hit.o) {
      state.removed.push({
        id: hit.o.id,
        type: hit.kind === 'inst' ? 'instance_box' : 'feed_point',
        ai_source: hit.o.src,
        reason: 'human_rejected',
        at: new Date().toISOString()
      });
    }
    state.inst = state.inst.filter(function (o) { return o.id !== state.sel; });
    state.feed = state.feed.filter(function (o) { return o.id !== state.sel; });
    toast('已删除 ' + state.sel + ' · 记入误检审计');
    state.sel = null;
    render();
  }

  /* ============ 类目过滤 ============ */

  var cats = Array.prototype.slice.call(document.querySelectorAll('.cat'));
  var overlay = $('overlay');

  cats.forEach(function (c) {
    c.addEventListener('click', function () {
      cats.forEach(function (o) { o.classList.remove('active'); });
      c.classList.add('active');
      overlay.classList.remove('focus-Q', 'focus-S', 'focus-R', 'focus-I', 'focus-BF');
      overlay.classList.add('focus-' + c.dataset.key);
      toast('当前类目：' + c.querySelector('.cat-name').textContent);
    });
  });

  /* ============ 判据 ============ */

  var VALUE_MAP = {
    P: { P1: 'P1 中央堆叠', P2: 'P2 全盘分布', P3: 'P3 稀疏散点', P4: 'P4 环形贴边', P9: 'P9 不可判定' },
    A5: { '0': '完整 5 对', '1': '缺损 1–2 片', '2': '缺损 3–4 片', '3': '严重缺损', '4': '尾肢全缺', '9': '不可判定' }
  };

  Array.prototype.forEach.call(document.querySelectorAll('.optrow'), function (row) {
    var group = row.dataset.group;
    var judge = row.closest('.judge');
    var out = judge ? judge.querySelector('.judge-val') : null;

    Array.prototype.forEach.call(row.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        Array.prototype.forEach.call(row.querySelectorAll('button'), function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        var v = btn.textContent.trim();
        var label = VALUE_MAP[group] && VALUE_MAP[group][v];
        if (out) out.innerHTML = '当前：<b>' + (label || v) + '</b>';

        /* A5 选中个体时写该尾，否则作为帧级代理值 */
        if (group === 'A5') {
          var hit = state.sel ? findObj(state.sel) : null;
          if (hit && hit.kind === 'inst') {
            snapshot();
            hit.o.a5 = v;
            hit.o.a5explicit = true;
            state.edited[hit.o.id] = 1;
            render();
            toast(hit.o.id + ' · A5 写入 ' + v + '（逐尾判据）');
          } else {
            var note = $('a5Note');
            if (note) note.innerHTML = '当前：<b>' + (label || v) + '</b> · 帧级代理值，选中个体框后写该尾';
            toast('A5 = ' + v + ' · 当前为帧级代理值；选中个体框可写单尾');
          }
        }
      });
    });
  });

  /* 个体健康工具条：health 是虾个体的属性，不新增 COCO 类目 */
  var healthBarEl = $('healthBar');
  if (healthBarEl) {
    healthBarEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.hb[data-health]') : null;
      if (!btn) return;
      var hit = state.sel ? findObj(state.sel) : null;
      if (!hit || hit.kind !== 'inst') { toast('先选中一个虾个体'); return; }
      var o = hit.o;
      if ((o.cls || 'shrimp') !== 'shrimp') { toast('仅虾个体可标健康状态'); return; }
      var v = btn.getAttribute('data-health') || '';
      snapshot();
      if (v) o.health = v;
      else delete o.health;
      state.edited[o.id] = 1;
      render();
      toast(v ? o.id + ' · 健康状态 ' + (HEALTH_LABEL[v] || v) : o.id + ' · 已清除健康标签');
    });
  }

  /* 头壳/蜕壳颜色录入：写入 o.attrs.color，供 E1 聚合主色 */
  var colorBarEl = $('colorBar');
  if (colorBarEl) {
    colorBarEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.hb[data-color]') : null;
      if (!btn) return;
      var hit = state.sel ? findObj(state.sel) : null;
      if (!hit || hit.kind !== 'inst') { toast('先选中头壳或蜕壳对象'); return; }
      var o = hit.o;
      var cls = o.cls || 'shrimp';
      if (cls !== 'head_shell' && cls !== 'molt') { toast('仅头壳/蜕壳可录颜色'); return; }
      var v = btn.getAttribute('data-color') || '';
      snapshot();
      o.attrs = o.attrs || {};
      if (v) o.attrs.color = v;
      else delete o.attrs.color;
      state.edited[o.id] = 1;
      render();
      toast(v ? o.id + ' · 颜色 ' + (COLOR_LABEL[v] || v) : o.id + ' · 已清除颜色');
    });
  }

  var onlyJudgeable = $('onlyJudgeable');
  onlyJudgeable.addEventListener('change', function () {
    var on = onlyJudgeable.checked;
    Array.prototype.forEach.call(document.querySelectorAll('.dimsec.dim-lock'), function (s) {
      s.style.display = on ? 'none' : '';
    });
    Array.prototype.forEach.call(document.querySelectorAll('.dimsec:not(.dim-lock) .judge.locked'), function (j) {
      j.style.display = on ? 'none' : '';
    });
    toast(on ? '已收起不可判维度' : '已显示六维全部维度');
  });

  /* ============ 导出 / 保存 ============ */

  function readLabels() {
    var out = {};
    Array.prototype.forEach.call(document.querySelectorAll('.optrow[data-group]'), function (row) {
      var b = row.querySelector('button.on');
      out[row.dataset.group] = b ? b.textContent.trim() : '9';
    });
    ['P', 'A5', 'A1-A3', 'A4', 'B2', 'B3', 'C4', 'C', 'CA', 'D', 'D2', 'D4', 'E', 'E1', 'E3', 'F', 'F3', 'G2', 'H'].forEach(function (k) {
      if (!out[k]) out[k] = '9';
    });
    return out;
  }

  /* 六维归组：A 体表 / B 体色与鳃 / C 姿态 / D 肠道 / E 体长 / F 摄食 / G 群体 / H 环境
     PRD 新增项按语义就近归入：C4→B(体色)、D2/D4→D、F3→F、E1/E3→G(群体残体)、G2→G、H→H */
  function dimensionOf(code) {
    if (/^A[0-9]/.test(code)) return 'A';
    if (/^B[0-9]/.test(code)) return 'B';
    if (code === 'C4') return 'B';            /* PRD 附肢颜色属体色 */
    if (/^C/.test(code)) return 'C';
    if (code === 'D' || code === 'D2' || code === 'D4') return 'D';
    if (code === 'E') return 'E';
    if (code === 'E1' || code === 'E3') return 'G';  /* PRD 蜕壳残体属群体级 */
    if (code === 'F' || code === 'F3') return 'F';
    if (code === 'G2') return 'G';
    if (code === 'H') return 'H';
    return 'G';   /* 群体级：P 分布形态 / M 群体指标 */
  }

  function buildDimensions(labels) {
    var names = {
      A: '体表完整性', B: '体色与鳃', C: '姿态与活动',
      D: '肠道充盈度', E: '体长与体重', F: '摄食档',
      G: '群体级（§8.9 / §8.10 / PRD 蜕壳残体·病健比）', H: '环境（传感器）'
    };
    var out = {};
    Object.keys(labels).forEach(function (code) {
      var d = dimensionOf(code);
      if (!out[d]) out[d] = { name: names[d], items: {} };
      out[d].items[code] = labels[code];
    });
    return out;
  }

  /* ============ 采集元数据与判读资格（§5.3.1 / §5.4 / §6.6） ============ */

  var STABLE_MIN_S = 0.5;   /* §5.3：低于 0.5 s 不构成稳定期 */
  var STABLE_REF_S = 5.0;   /* §5.3 实测参考值：固定机位电动提台应 ≥ 5 s */
  var COLOR_E_GRAY_MAX = 3.0;   /* §6.6.1 灰阶 ΔE00 ≤ 3.0 */
  var COLOR_E_MEAN_MAX = 5.0;   /* §6.6.1 24 色块平均 ΔE00 ≤ 5.0 */

  function collectMeta() {
    var fixed = $('fixedCamera').value === '1';
    var wb = $('wbCard').value === '1';
    var sw = parseFloat($('stableWin').value);
    if (!isFinite(sw) || sw < 0) sw = 0;
    return {
      pond_id: ($('pondId').value || '').trim() || null,
      obs_id: ($('obsId').value || '').trim() || null,
      device_id: ($('deviceId').value || '').trim() || null,
      shoot_time: $('shootTime').value || null,
      fixed_camera: fixed,
      wb_card: wb,
      stable_window_s: sw
    };
  }

  /* 色彩标定：白卡入画 + 灰阶/24 色块 ΔE00 双阈值（§6.6.1） */
  function colorCalib() {
    var ver = ($('calibVer').value || '').trim() || null;
    var g = parseFloat($('deltaEGray').value);
    var c = parseFloat($('deltaEColor').value);
    var hasWb = $('wbCard').value === '1';
    var grayOk = isFinite(g) && g <= COLOR_E_GRAY_MAX;
    var meanOk = isFinite(c) && c <= COLOR_E_MEAN_MAX;
    var reasons = [];
    if (!hasWb) reasons.push('NO_WB_CARD');
    if (!grayOk) reasons.push('DELTA_E_GRAY_FAIL');
    if (!meanOk) reasons.push('DELTA_E_MEAN_FAIL');
    if (!ver) reasons.push('NO_CALIB_VERSION');
    return {
      version: ver,
      wb_card_in_frame: hasWb,
      delta_e_gray: isFinite(g) ? g : null,
      delta_e_mean_24: isFinite(c) ? c : null,
      thresholds: { delta_e_gray_max: COLOR_E_GRAY_MAX, delta_e_mean_24_max: COLOR_E_MEAN_MAX },
      pass: hasWb && grayOk && meanOk,
      reasons: reasons
    };
  }

  /* 阻断项决定能否进训练集；警告项只影响颜色类判据 */
  function gateState(m) {
    var mm = m || metrics();
    var meta = collectMeta();
    var cc = colorCalib();
    var pxOk = mm.pxcm >= BASE_TIER;
    var block = [];
    var warn = cc.pass ? [] : cc.reasons.slice();
    if (!meta.fixed_camera) block.push('NO_FIXED_CAMERA');
    if (meta.stable_window_s < STABLE_MIN_S) block.push('STABLE_LT_0_5S');
    else if (meta.stable_window_s < STABLE_REF_S) warn.push('STABLE_LT_5S');
    if (!pxOk) block.push('PXCM_LT_10');
    return {
      eligible: block.length === 0,
      px_ok: pxOk,
      meta: meta,
      block: block,
      warn: warn,
      reason_codes: block.concat(warn),
      color_calib: cc,
      color_calibrated: cc.pass
    };
  }

  ['fixedCamera', 'wbCard', 'stableWin', 'pondId', 'obsId', 'deviceId', 'shootTime',
    'calibVer', 'deltaEGray', 'deltaEColor']
    .forEach(function (id) {
      var n = $(id);
      if (!n) return;
      n.addEventListener('change', function () { render(); });
      n.addEventListener('input', function () { render(); });
    });

  /* ============ 双人盲标与一致性（§15.3） ============ */

  var KAPPA_MIN = 0.60;
  var BLIND_COVERAGE_MIN = 0.20;

  function parseSecondPass(text) {
    var out = {};
    if (!text) return out;
    text.split(/[,，;；\n]+/).forEach(function (seg) {
      var m = seg.split(/[=:：]/);
      if (m.length !== 2) return;
      var k = m[0].trim().toUpperCase();
      var v = m[1].trim();
      if (k && v) out[k] = v;
    });
    return out;
  }

  function cohenKappa(av, bv) {
    var n = av.length;
    if (!n) return null;
    var agree = 0, ca = {}, cb = {};
    for (var i = 0; i < n; i++) {
      if (av[i] === bv[i]) agree++;
      ca[av[i]] = (ca[av[i]] || 0) + 1;
      cb[bv[i]] = (cb[bv[i]] || 0) + 1;
    }
    var pe = 0;
    Object.keys(ca).forEach(function (k) { pe += (ca[k] / n) * ((cb[k] || 0) / n); });
    return (1 - pe) === 0 ? 1 : (agree / n - pe) / (1 - pe);
  }

  function doubleBlind() {
    var a = readLabels();
    var b = parseSecondPass($('secondPass').value || '');
    var keys = Object.keys(b).filter(function (k) { return k in a; });
    var av = [], bv = [], agreeN = 0;
    keys.forEach(function (k, i) {
      av.push(String(a[k]));
      bv.push(String(b[k]));
      if (av[i] === bv[i]) agreeN++;
    });
    var total = Object.keys(a).length;
    var cov = total ? keys.length / total : 0;
    var kappa = cohenKappa(av, bv);
    var reviewerA = ($('annotatorId').value || '').trim() || null;
    var reviewerB = ($('annotatorId2').value || '').trim() || null;
    return {
      reviewer_a: reviewerA,
      reviewer_b: reviewerB,
      blind_keys: keys.length,
      total_keys: total,
      coverage_ratio: Number(cov.toFixed(3)),
      agree_rate: keys.length ? Number((agreeN / keys.length).toFixed(3)) : null,
      kappa: kappa === null ? null : Number(kappa.toFixed(3)),
      kappa_min: KAPPA_MIN,
      coverage_min: BLIND_COVERAGE_MIN,
      pass: cov >= BLIND_COVERAGE_MIN && kappa !== null && kappa >= KAPPA_MIN
    };
  }

  function renderKappa() {
    var db = doubleBlind();
    var out = $('kappaOut');
    var st = $('kappaStat');
    if (db.kappa === null) {
      out.className = 'bad';
      out.textContent = '未录入';
      st.textContent = '—';
      return db;
    }
    out.className = db.pass ? 'ok' : 'bad';
    out.textContent = 'κ ' + db.kappa.toFixed(3);
    st.textContent = '覆盖 ' + (db.coverage_ratio * 100).toFixed(0) + '% · 一致率 ' +
      (db.agree_rate * 100).toFixed(0) + '%';
    return db;
  }

  $('btnKappa').addEventListener('click', function () {
    var db = renderKappa();
    if (db.kappa === null) { toast('请先录入复核员 B 的盲标'); return; }
    toast(db.pass
      ? '双人盲标达标：覆盖率 ' + (db.coverage_ratio * 100).toFixed(0) + '% · κ ' + db.kappa.toFixed(3)
      : '未达标：需覆盖 ≥20% 且 κ ≥0.60');
  });

  $('secondPass').addEventListener('input', renderKappa);
  $('annotatorId2').addEventListener('input', renderKappa);
  $('annotatorId').addEventListener('input', renderKappa);

  $('btnMetaToggle').addEventListener('click', function () {
    var willShow = metaBody.hidden;
    metaBody.hidden = !willShow;
    this.textContent = willShow ? '收起' : '展开';
  });

  function buildRecord() {
    var m = metrics();
    var ok = m.pxcm >= BASE_TIER;
    var labels = readLabels();
    var pt = perTail();
    var gs = gateState(m);
    var meta = gs.meta;
    var eligible = gs.eligible;
    var db = doubleBlind();
    var annotator = db.reviewer_a || 'A-07';
    var cap = deviceCapability(m.pxcm, gs.color_calibrated);
    return {
      schema_version: 'anno-1.0',
      standard: 'Q/HMZH 001—2026',
      phase: state.phase,
      phase_rule: state.phase === 2 ? '每尾 A5 必须显式判定，未逐尾不得导出' : '允许帧级代理值，逐尾可覆盖',
      frame_id: FRAME_ID,
      frame_index: 45,
      source_video: '47c34d8d.mp4',
      pond_id: meta.pond_id,
      obs_id: meta.obs_id,
      device_id: meta.device_id,
      shoot_time: meta.shoot_time,
      image: { width: IMG_W, height: IMG_H, file: 'assets/frame_045.jpg' },
      calibrator: annotator,
      calibrated: {
        method: 'manual_quad_corners',   /* 目视四分点，非色块自动定位 */
        tray_shape: m.shape,              /* 新增：square / round */
        side_cm: m.side,
        side_cm_semantics: m.shape === 'round' ? 'diameter_cm' : 'side_length_cm',
        side_cm_source: 'manual_field_measurement',  /* 现场实测手动填写，不预设 100/80 */
        px_per_cm: Number(m.pxcm.toFixed(2)),
        px_per_cm_min_side: Number((((m.edges[1] + m.edges[3]) / 2) / m.side).toFixed(2)),
        corners_px: state.corners.map(function (p) { return { x: Math.round(p.x), y: Math.round(p.y) }; }),
        tray_outline_px: state.trayOutline ? state.trayOutline.map(function (p) {
          return Array.isArray(p) ? [Math.round(p[0]), Math.round(p[1])] : p;
        }) : null,
        tray_outline_source: state.trayShape ? 'vlm_preannotate' : null,
        edge_px: m.edges.map(function (v) { return Number(v.toFixed(1)); }),
        tier: ok ? 'basic' : 'none',
        color_calib_version: gs.color_calib.version,
        color_calib_pass: gs.color_calib.pass
      },
      color_calib: gs.color_calib,
      gate: {
        sampling_tier: ok ? 'basic' : 'none',
        stable_window_s: meta.stable_window_s,
        fixed_camera: meta.fixed_camera,
        wb_card: meta.wb_card,
        eligible: eligible,
        reason_codes: gs.reason_codes,
        blocking_codes: gs.block,
        warning_codes: gs.warn
      },
      /* 设备能力：统一由 deviceCapability 生成，改 CLOSEUP_STATUS 即全量联动 */
      capability: cap,
      objects: [
        { id: 'S01', type: 'school_segmentation', source: state.edited.S01 ? 'human' : 'ai',
          points: state.school.map(function (p) { return { x: Math.round(p.x), y: Math.round(p.y) }; }) },
        state.inst.map(function (o) {
          var zn = zoneOf(o);
          return { id: o.id, type: 'instance_box', cls: o.cls || 'shrimp', source: state.edited[o.id] ? 'human' : o.src,
            zone: zn, counted: (o.cls || 'shrimp') === 'shrimp' && zn === 'edge', x: o.x, y: o.y, w: o.w, h: o.h,
            attrs: o.attrs || null,
            labels: { A5: o.a5 || '9' }, label_scope: o.a5explicit ? 'instance' : 'frame_proxy' };
        }),
        state.rope.map(function (r, k) {
          var id = 'R0' + (k + 1);
          return { id: id, type: 'ignore_mask_line', source: state.edited[id] ? 'human' : r.src,
            x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 };
        }),
        state.feed.map(function (o) {
          return { id: o.id, type: 'feed_point', source: state.edited[o.id] ? 'human' : o.src, x: o.x, y: o.y };
        })
      ].flat(),
      group_metrics: {
        occupancy_ratio: Number((schoolArea(state.school) / schoolArea(state.corners)).toFixed(3)),
        center_silhouette_ratio: null,   /* 需中央区与剪影求交，原型未实现，留空不臆造 */
        edge_visible_shrimp: state.inst.filter(function (o) { return zoneOf(o) === 'edge'; }).length,
        cluster_aspect_ratio: Number(clusterAspect(state.school).toFixed(2)),
        cluster_centroid_offset_cm: Number((clusterOffsetCm(state.school, centroid(), m.pxcm)).toFixed(1))
      },
      dimensions: buildDimensions(labels),
      frame_labels: labels,
      derived_metrics: derivedMetrics(),
      per_tail_a5: {
        required: state.phase === 2,
        total_edge: pt.total,
        explicit: pt.explicit,
        missing: pt.missing,
        complete: pt.complete
      },
      label_coverage: labelCoverage(labels),
      removed_ai_objects: state.removed,
      geometry_reuse: state.reuse || { from: 45, to: 45, applied: false },
      admission: {
        eligible_for_trainset: eligible,
        color_calibrated: gs.color_calibrated,
        reason: eligible ? 'gate_passed' : ('gate_blocked:' + gs.block.join('+')),
        usable_as: eligible ? ['trainset', 'audit'] : ['audit_only'],
        audit_note: eligible
          ? (gs.color_calibrated
              ? '已过判读资格（固定机位 / 稳定期 / 采样率）且色彩标定 ΔE00 达 §6.6.1 阈值，可进训练集'
              : '已过判读资格，但色彩标定未通过（' + gs.color_calib.reasons.join('、') + '）：几何与计数类可进训练集，颜色类（B/B2/B3）仍记 9，不得用于色差训练')
          : '未过判读资格（' + gs.block.join('、') + '），仅可作采集质量与几何标定的复核样本，不得进训练集'
      },
      reviewer: annotator,
      reviewed_by: db.reviewer_b,
      double_blind: db,
      review_status: db.pass ? 'double_checked' : 'draft',
      annotated_at: new Date().toISOString()
    };
  }

  function schoolArea(pts) { return Math.abs(polygonArea(pts)); }

  function clusterAspect(pts) {
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    var h = Math.max.apply(null, ys) - Math.min.apply(null, ys);
    return h > 0 ? (Math.max.apply(null, xs) - Math.min.apply(null, xs)) / h : 0;
  }

  function clusterOffsetCm(pts, c, pxcm) {
    var sx = 0, sy = 0;
    pts.forEach(function (p) { sx += p.x; sy += p.y; });
    sx /= pts.length; sy /= pts.length;
    return pxcm ? Math.hypot(sx - c.x, sy - c.y) / pxcm : 0;
  }

  /* 9 类占比：单帧预警（规程按批次两周统计，这里只提示，不直接判定） */
  function labelCoverage(labels) {
    var keys = Object.keys(labels);
    var nine = keys.filter(function (k) {
      var v = String(labels[k]);
      return v === '9' || v === 'P9';
    }).length;
    return {
      judged: keys.length,
      nine: nine,
      nine_ratio: keys.length ? Number((nine / keys.length).toFixed(3)) : 1,
      threshold_batch: 0.15,
      warn: '#9 占比偏高时按批次复核，连续两周 >15% 应暂停标注'
    };
  }

  /* COCO 导出：可直接进训练管线（类别 id 与 YOLO/COCO 通用） */
  function buildCoco() {
    var m = metrics();
    var pt = perTail();
    var gs = gateState(m);
    var cap = deviceCapability(m.pxcm, gs.color_calibrated);
    var anns = [];
    var aid = 1;

    var sx = state.school.map(function (p) { return Math.round(p.x); });
    var sy = state.school.map(function (p) { return Math.round(p.y); });
    var bx = Math.min.apply(null, sx);
    var by = Math.min.apply(null, sy);
    var bw = Math.max.apply(null, sx) - bx;
    var bh = Math.max.apply(null, sy) - by;
    var seg = [];
    state.school.forEach(function (p) { seg.push(Math.round(p.x), Math.round(p.y)); });

    anns.push({
      id: aid++, image_id: 1, category_id: 1, iscrowd: 0,
      segmentation: [seg], area: polygonArea(state.school), bbox: [bx, by, bw, bh],
      attributes: { source: state.edited.S01 ? 'human' : 'ai', level: 'group' }
    });

    anns.push({
      id: aid++, image_id: 1, category_id: 1, iscrowd: 0,
      segmentation: [state.corners.reduce(function (a, p) {
        a.push(Math.round(p.x), Math.round(p.y)); return a;
      }, [])],
      area: schoolArea(state.corners),
      bbox: [
        Math.min.apply(null, state.corners.map(function (p) { return p.x; })),
        Math.min.apply(null, state.corners.map(function (p) { return p.y; })),
        Math.max.apply(null, state.corners.map(function (p) { return p.x; })) -
          Math.min.apply(null, state.corners.map(function (p) { return p.x; })),
        Math.max.apply(null, state.corners.map(function (p) { return p.y; })) -
          Math.min.apply(null, state.corners.map(function (p) { return p.y; }))
      ],
      attributes: { source: 'human', level: 'tray' }
    });

    /* category id 与对象类型一一对应；7-9 为辅助证据类，先进审计不进检测训练集 */
    var CID = { shrimp: 2, molt: 4, dead: 5, head_shell: 7, meat_fragment: 8, feces: 9 };
    state.inst.forEach(function (o) {
      var zn = zoneOf(o);
      var cls = o.cls || 'shrimp';
      var cid = CID[cls] || 2;
      anns.push({
        id: aid++, image_id: 1, category_id: cid, iscrowd: 0,
        segmentation: [], area: o.w * o.h, bbox: [o.x, o.y, o.w, o.h],
        attributes: { source: state.edited[o.id] ? 'human' : o.src, cls: cls, zone: zn,
          counted: cls === 'shrimp' && zn === 'edge', A5: cls === 'shrimp' ? (o.a5 || '9') : null,
          health: cls === 'shrimp' ? (o.health || null) : null }
      });
    });

    state.feed.forEach(function (o) {
      anns.push({
        id: aid++, image_id: 1, category_id: 3, iscrowd: 0,
        segmentation: [], area: 400, bbox: [o.x - 10, o.y - 10, 20, 20],
        attributes: { source: state.edited[o.id] ? 'human' : o.src }
      });
    });

    return {
      info: {
        description: '料台视觉标注导出 · Q/HMZH 001—2026',
        schema_version: 'coco-anno-1.0',
        phase: state.phase,
        px_per_cm: Number(m.pxcm.toFixed(2)),
        side_cm: m.side,
        side_cm_source: 'manual_field_measurement',
        sampling_tier: m.pxcm >= BASE_TIER ? 'basic' : 'none',
        eligible_for_trainset: gs.eligible,
        color_calibrated: gs.color_calibrated,
        color_calib: gs.color_calib,
        pond_id: gs.meta.pond_id,
        obs_id: gs.meta.obs_id,
        device_id: gs.meta.device_id,
        shoot_time: gs.meta.shoot_time,
        reason_codes: gs.reason_codes,
        double_blind: doubleBlind(),
        per_tail_a5: {
          required: state.phase === 2,
          total_edge: pt.total, explicit: pt.explicit, complete: pt.complete
        },
        /* COCO 只带精简字段，但字段值全部来自 deviceCapability，不再手写一份 */
        capability: {
          closeup_station: cap.closeup_station,
          closeup_station_status: cap.closeup_station_status,
          closeup_px_per_cm: cap.closeup_px_per_cm,
          dims_enabled: cap.dims_enabled,
          cameras: cap.cameras,
          permanent_locked_dimensions: cap.permanent_locked_dimensions,
          provisional_locked_dimensions: cap.provisional_locked_dimensions,
          note: cap.note
        },
        enclosing_roi_px: state.corners.map(function (p) { return [Math.round(p.x), Math.round(p.y)]; }),
        ignore_regions_lines: state.rope.map(function (r) {
          return [[r.x1, r.y1], [r.x2, r.y2]];
        })
      },
      images: [{ id: 1, file_name: 'frame_045.jpg', width: IMG_W, height: IMG_H, frame_index: 45 }],
      annotations: anns,
      categories: [
        { id: 1, name: 'tray_plate', supercategory: 'object', segmentation: true, zh: '料台盘面' },
        { id: 2, name: 'shrimp_instance', supercategory: 'individual', segmentation: false, zh: '虾个体' },
        { id: 3, name: 'residual_feed', supercategory: 'object', segmentation: false, zh: '残饵' },
        { id: 4, name: 'molt_exuvia', supercategory: 'object', segmentation: false, zh: '蜕壳' },
        { id: 5, name: 'dead_shrimp', supercategory: 'individual', segmentation: false, zh: '死亡个体' },
        /* 虾群剪影仅用于群体指标（占用率/分布形态），不属 YOLO 交付 5 类 */
        { id: 6, name: 'shrimp_school', supercategory: 'group', segmentation: true,
          zh: '虾群剪影（群体指标用）', exclude_from_detection_trainset: true },
        /* 7-9 辅助证据类：本里程碑先进审计，暂不进检测训练集 */
        { id: 7, name: 'head_shell', supercategory: 'object', segmentation: false, zh: '头壳',
          exclude_from_detection_trainset: true },
        { id: 8, name: 'meat_fragment', supercategory: 'object', segmentation: false, zh: '肉段',
          exclude_from_detection_trainset: true },
        { id: 9, name: 'feces', supercategory: 'object', segmentation: false, zh: '粪块',
          exclude_from_detection_trainset: true }
      ]
    };
  }

  /* ============ 本地 VLM 调用（LM Studio · qwen/qwen3-vl-8b） ============ */

  /* 把当前画布帧截成 1440×1920 的 base64 JPEG；SVG overlay 不画进去，VLM 只看原始像素 */
  function screenshotFrame() {
    var img = $('frameImg');
    var canvas = document.createElement('canvas');
    canvas.width = IMG_W;
    canvas.height = IMG_H;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, IMG_W, IMG_H);
    return canvas.toDataURL('image/jpeg', 0.8);
  }

  function extractJSON(text) {
    if (!text) return null;
    var t = text.trim();
    if (t.startsWith('```')) {
      t = t.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    try { return JSON.parse(t); } catch (e) {}
    var m = t.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
    return null;
  }

  function callLocalVL(promptText, dataURL) {
    var payload = {
      model: VL_MODEL_ID,
      messages: [
        { role: 'system',
          content: '你是水产视觉标注助手。严格按要求返回一个 JSON 对象，不要任何解释、不要 markdown 代码块、不要 ``` 包裹。' },
        { role: 'user', content: [
          { type: 'text', text: promptText },
          { type: 'image_url', image_url: { url: dataURL } }
        ]}
      ],
      max_tokens: 600,
      temperature: 0.05
    };
    var xhr = new XMLHttpRequest();
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        try { xhr.abort(); } catch (e) {}
        reject(new Error('调用本地模型超时（>' + Math.round(VL_TIMEOUT_MS/1000) + 's）；请确认 LM Studio server 正在运行（lms server start）'));
      }, VL_TIMEOUT_MS);
      xhr.open('POST', VL_BASE_URL + '/chat/completions', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = function () {
        clearTimeout(timer);
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error('本地模型返回 HTTP ' + xhr.status + '：' + (xhr.responseText || '').slice(0, 160)));
          return;
        }
        try {
          var r = JSON.parse(xhr.responseText);
          resolve(r);
        } catch (e) {
          reject(new Error('解析本地模型响应失败：' + e.message));
        }
      };
      xhr.onerror = function () {
        clearTimeout(timer);
        reject(new Error('无法连接 ' + VL_BASE_URL + '；请先在 LM Studio 里启动 server（Settings → Start Server on Localhost）'));
      };
      xhr.send(JSON.stringify(payload));
    });
  }

  /* 提示词按当前帧的真实尺寸拼接（导入素材尺寸不固定） */
  function vlPrompt() {
    return (
    '这是一张"对虾料台提台出水"现场帧，图片尺寸 ' + IMG_W + ' × ' + IMG_H + '。料台是画面中央的容器（方形或圆形），里面可以看到活着的虾群。\n\n' +
    '你是严格按 JSON schema 输出的标注助手。只返回一个 JSON，不要任何其他文字、不要代码块。\n\n' +
    '{\n' +
    '  "distribution": "P1/P2/P3/P4/P9",\n' +
    '  "sample_a5": [ 3-5 个边缘区清晰个体的 A5 尾肢等级字符串 ],\n' +
    '  "tray_shape": "square" 或 "round" 或 null,\n' +
    '  "tray_outline": [ [x,y], ... ]  // 方形给 4 个角点（左上→右上→右下→左下）；圆形给圆心+半径即 [[cx,cy], radius]；看不清则 []\n' +
    '  "has_food": true/false,\n' +
    '  "feed_pellets": [ {"x": 700, "y": 640} ],  // 如果料台内能清晰看到未被吃掉的饲料颗粒，给 3-8 个坐标；如果看不清或没有，返回 []\n' +
    '  "notes": "简要说明不确定的地方（中文）"\n' +
    '}\n\n' +
    '坐标规则：所有 x 在 0-' + IMG_W + '，y 在 0-' + IMG_H + '。feed_pellets 坐标必须在料台内部，画到料台外就是错的。\n' +
    'P1=中央堆叠 P2=全盘分布 P3=稀疏散点 P4=环形贴边 P9=无法判定\n' +
    'A5: "0"完整 "1"缺损1-2片 "2"缺损3-4片 "3"严重 "4"全缺 "9"看不清\n' +
    '只在边缘区挑 A5 示例，中央区重叠严重不要判。\n'
    );
  }

  function applyAIPreannotate(ai) {
    if (!ai || typeof ai !== 'object') return;
    var applied = [];

    /* P 分布形态 */
    if (ai.distribution && /^P[1-49]$/.test(ai.distribution)) {
      var pRow = document.querySelector('.optrow[data-group="P"]');
      if (pRow) {
        Array.prototype.forEach.call(pRow.querySelectorAll('button'), function (b) {
          b.classList.remove('on');
          if (b.textContent.trim() === ai.distribution) b.classList.add('on');
        });
        var judgeVal = pRow.closest('.judge').querySelector('.judge-val');
        if (judgeVal) judgeVal.innerHTML = 'AI 预标：<b>' + ai.distribution + '</b> · ' + (ai.notes || '');
      }
      applied.push('P=' + ai.distribution);
    }

    /* A5 示例 → 写帧级代理值 */
    if (ai.sample_a5 && Array.isArray(ai.sample_a5) && ai.sample_a5.length) {
      var counts = {};
      ai.sample_a5.forEach(function (v) {
        counts[v] = (counts[v] || 0) + 1;
      });
      var best = ai.sample_a5[0];   /* 取第一个示例做代理 */
      var a5Row = document.querySelector('.optrow[data-group="A5"]');
      if (a5Row) {
        Array.prototype.forEach.call(a5Row.querySelectorAll('button'), function (b) {
          b.classList.remove('on');
          if (b.textContent.trim() === best) b.classList.add('on');
        });
        var a5JudgeVal = a5Row.closest('.judge').querySelector('.judge-val');
        var dist = Object.keys(counts).map(function (k) { return k + ':' + counts[k]; }).join('/');
        if (a5JudgeVal) a5JudgeVal.innerHTML = 'AI 预标：<b>' + best + '</b>（' + ai.sample_a5.length + ' 只示例分布 ' + dist + '）· 一期帧级代理，选中个体框后写该尾';
        var note = $('a5Note');
        if (note) note.innerHTML = 'AI 预标：<b>' + best + '</b> · 示例分布 ' + dist;
      }
      applied.push('A5 示例=' + ai.sample_a5.join('/'));
    }

    /* 料台轮廓 + 形状（VLM 预标，供几何标定入口用） */
    if (ai.tray_shape && (ai.tray_shape === 'square' || ai.tray_shape === 'round')) {
      state.trayShape = ai.tray_shape;
      applied.push('tray_shape=' + ai.tray_shape);
    }
    if (Array.isArray(ai.tray_outline) && ai.tray_outline.length >= 3) {
      var pts = ai.tray_outline.map(function (p) { return [p[0], p[1]]; });
      /* 过滤：bbox 面积超过图片 90% 说明模型没识别出料台，fallback 了整图 */
      var xs = pts.map(function (p) { return p[0]; });
      var ys = pts.map(function (p) { return p[1]; });
      var bw = Math.max.apply(null, xs) - Math.min.apply(null, xs);
      var bh = Math.max.apply(null, ys) - Math.min.apply(null, ys);
      if ((bw * bh) < IMG_W * IMG_H * 0.9) {
        state.trayOutline = pts;
        applied.push('tray_outline=' + pts.length + 'pt');
      } else {
        toast('AI 未能识别料台轮廓（返回了整图），请在侧栏手动画料台四角');
      }
    }

    /* 残饵自动打点（VLM 坐标，加 low-confidence 标记） */
    var addedFeed = 0;
    if (Array.isArray(ai.feed_pellets) && ai.feed_pellets.length) {
      ai.feed_pellets.forEach(function (fp) {
        if (typeof fp.x !== 'number' || typeof fp.y !== 'number') return;
        if (fp.x < 0 || fp.x > IMG_W || fp.y < 0 || fp.y > IMG_H) return;
        /* 距离画面边缘 < 20px 大概率是模型编造，跳过 */
        if (fp.x < 20 || fp.x > IMG_W - 20 || fp.y < 20 || fp.y > IMG_H - 20) return;
        /* 如果有料台轮廓，检查点是否在料台内；不在则跳过 */
        if (state.trayOutline && state.trayShape === 'square') {
          var inside = pointInPoly(fp.x, fp.y, state.trayOutline);
          if (!inside) return;
        }
        var id = 'BF' + String(nextFeed++).padStart(2, '0');
        state.feed.push({ id: id, x: Math.round(fp.x), y: Math.round(fp.y), src: 'ai-vlm', lowConfidence: true });
        addedFeed++;
      });
    }
    if (addedFeed > 0) {
      applied.push('feed_pellets=' + addedFeed + '（低置信度）');
    } else if (ai.has_food === false) {
      /* 明确说没残饵才提示，空数组可能是模型不确定 */
      toast('AI 提示画面未见残饵，BF 类目可先跳过');
    } else if (ai.has_food === true && addedFeed === 0) {
      toast('AI 认为有残饵但未能给出可信坐标，请人工查看后手动打点');
    }

    return applied;
  }

  /* 点是否在多边形内（射线法） */
  function pointInPoly(px, py, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1];
      var xj = poly[j][0], yj = poly[j][1];
      var intersect = ((yi > py) !== (yj > py)) &&
                      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /* 只负责调用模型并解析 JSON；应用结果由调用方决定（单帧 / 批量复用同一套） */
  function aiPreannotateFrame() {
    var dataURL = screenshotFrame();
    return callLocalVL(vlPrompt(), dataURL).then(function (resp) {
      var raw = resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
      var ai = extractJSON(raw);
      if (!ai) {
        throw new Error('模型返回内容无法解析为 JSON：' + (raw || '（空）').slice(0, 200));
      }
      return ai;
    });
  }

  function runAIPreannotate() {
    var btn = $('wzRunAI');
    btn.disabled = true;
    btn.classList.add('loading');
    btn.textContent = 'AI 预标注中…';
    toast('正在调用本地多模态模型，请稍候（首次约 1 分钟）');

    var started = Date.now();

    return aiPreannotateFrame().then(function (ai) {
      var secs = ((Date.now() - started) / 1000).toFixed(1);

      /* 整次 AI 预标注作为一个可撤销步骤 */
      snapshot();
      var applied = applyAIPreannotate(ai);
      render();
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.textContent = '重新预标注';

      if (applied.length) {
        toast('AI 预标注完成（' + secs + 's）· ' + applied.join(' · ') + ' · ⌘Z 可整体撤销');
      } else {
        toast('AI 返回有效但未在任何维度落地：' + (ai.notes || '—'));
      }
      return true;
    }).catch(function (err) {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.textContent = '重试 AI 预标注';
      toast('AI 预标注失败：' + err.message.slice(0, 140));
      return false;
    });
  }

  function polygonArea(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
      var j = (i + 1) % pts.length;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(a / 2);
  }

  /* ===== 输出目录（File System Access API；Safari 等不支持时自动回退浏览器下载） ===== */
  var outDirHandle = null;   // 已授权可直接写入的目录
  var outDirPending = null;  // 上次选过但权限需用户点一下恢复的目录
  var OUT_DIR_KEY = 'outdir';

  function idbOpen() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('annotator', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var q = db.transaction('kv').objectStore('kv').get(key);
        q.onsuccess = function () { res(q.result); };
        q.onerror = function () { rej(q.error); };
      });
    });
  }
  function idbSet(key, val) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }

  function renderOutDirUI() {
    var label = outDirHandle ? outDirHandle.name
      : outDirPending ? outDirPending.name + ' · 点恢复'
      : '未设置';
    var b = $('btnOutDir');
    b.textContent = '输出目录: ' + label;
    b.classList.toggle('on', !!outDirHandle);
    b.classList.toggle('pending', !outDirHandle && !!outDirPending);
    b.title = outDirHandle
      ? '每次导出直接写入该目录。点击可更换'
      : '设置标注成果输出目录（S09 / COCO 都写到这里）；不设置则走浏览器下载';
    var w = $('wzOutDir');
    w.classList.add('clickable');
    w.textContent = label;
    w.title = '点击设置/更换输出目录，导出会直接写入';
  }

  function pickOutDir() {
    if (!('showDirectoryPicker' in window)) {
      toast('当前浏览器不支持目录写入（Safari 不支持）。请用 Chrome/Edge 打开标注台，或继续用浏览器下载');
      return;
    }
    window.showDirectoryPicker({ mode: 'readwrite', id: 'annotator-out' }).then(function (h) {
      return h.requestPermission({ mode: 'readwrite' }).then(function (p) {
        if (p !== 'granted') { toast('未授予写入权限，导出仍走浏览器下载'); renderOutDirUI(); return; }
        outDirHandle = h; outDirPending = null;
        idbSet(OUT_DIR_KEY, h).catch(function () {});
        renderOutDirUI();
        toast('输出目录已设置：' + h.name + ' · 之后导出直接写入该目录');
      });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;
      console.error(e);
      toast('设置输出目录失败：' + ((e && e.message) || e));
    });
  }

  $('btnOutDir').addEventListener('click', function () {
    if (outDirPending) { /* 浏览器要求权限恢复必须在用户点击手势内 */
      outDirPending.requestPermission({ mode: 'readwrite' }).then(function (p) {
        if (p === 'granted') {
          outDirHandle = outDirPending; outDirPending = null;
          renderOutDirUI();
          toast('输出目录已恢复：' + outDirHandle.name);
        } else { toast('未恢复输出目录，导出仍走浏览器下载'); }
      });
      return;
    }
    pickOutDir();
  });
  $('wzOutDir').addEventListener('click', function () { $('btnOutDir').click(); });

  idbGet(OUT_DIR_KEY).then(function (h) {
    if (!h) return;
    var q = h.queryPermission ? h.queryPermission({ mode: 'readwrite' }) : Promise.resolve('denied');
    return Promise.resolve(q).then(function (p) {
      if (p === 'granted') outDirHandle = h; else outDirPending = h;
      renderOutDirUI();
    });
  }).catch(function () {});

  function fallbackDownload(text, name) {
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* 返回 Promise<boolean>：true=已直接写入输出目录（toast 由本函数负责），false=走了浏览器下载 */
  function download(obj, name) {
    var text = JSON.stringify(obj, null, 2);
    if (outDirHandle) {
      return outDirHandle.getFileHandle(name, { create: true }).then(function (fh) {
        return fh.createWritable().then(function (w) {
          return w.write(new Blob([text], { type: 'application/json' })).then(function () {
            return w.close();
          });
        });
      }).then(function () {
        toast('已写入 ' + outDirHandle.name + '/' + name);
        return true;
      }).catch(function (e) {
        console.error(e);
        fallbackDownload(text, name);
        toast('写入输出目录失败（' + ((e && e.name) || e) + '），已改用浏览器下载');
        return false;
      });
    }
    fallbackDownload(text, name);
    return Promise.resolve(false);
  }

  /* 二期硬门：未逐尾不得导出 */
  function blockedByGate() {
    if (state.phase !== 2) return false;
    var pt = perTail();
    if (pt.complete) return false;
    render();
    toast('二期硬门：' + pt.missing.join('、') + ' 未逐尾判 A5，禁止导出');
    return true;
  }

  /* ============ 批次数据包（§15.4 交付结构） ============ */

  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildMetadataCsv(rec) {
    var rows = [
      ['field', 'value'],
      ['frame_id', rec.frame_id],
      ['pond_id', rec.pond_id],
      ['obs_id', rec.obs_id],
      ['device_id', rec.device_id],
      ['shoot_time', rec.shoot_time],
      ['px_per_cm', rec.calibrated.px_per_cm],
      ['side_cm', rec.calibrated.side_cm],
      ['tray_shape', rec.calibrated.tray_shape],
      ['fixed_camera', rec.gate.fixed_camera],
      ['stable_window_s', rec.gate.stable_window_s],
      ['sampling_tier', rec.gate.sampling_tier],
      ['color_calib_pass', rec.color_calib.pass],
      ['color_calib_version', rec.color_calib.version],
      ['delta_e_gray', rec.color_calib.delta_e_gray],
      ['delta_e_mean_24', rec.color_calib.delta_e_mean_24],
      ['eligible_for_trainset', rec.admission.eligible_for_trainset],
      ['reason_codes', rec.gate.reason_codes.join('|')],
      ['reviewer', rec.reviewer],
      ['reviewed_by', rec.reviewed_by],
      ['kappa', rec.double_blind.kappa],
      ['blind_coverage', rec.double_blind.coverage_ratio]
    ];
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n') + '\n';
  }

  function buildReadme(rec) {
    return [
      '# 料台视觉标注数据包 · ' + rec.frame_id,
      '',
      '依据：Q/HMZH 001—2026《对虾料台视觉采集与健康分级技术规程》§15.4。',
      '',
      '## 目录结构',
      '- images/            原始帧（未做任何压缩外的处理）',
      '- annotations/       单帧 S09 记录与 COCO 标注',
      '- metadata/          逐帧采集元数据 CSV',
      '- calib/             几何标定与色彩标定记录',
      '- checksums.sha256   全部文件校验值',
      '',
      '## 本帧状态',
      '- 棚号 / 观测号：' + (rec.pond_id || '未填') + ' / ' + (rec.obs_id || '未填'),
      '- 空间采样率：' + rec.calibrated.px_per_cm + ' px/cm（档位 ' + rec.gate.sampling_tier + '）',
      '- 判读资格：' + (rec.admission.eligible_for_trainset ? '通过' : '未通过') +
        '（' + (rec.gate.reason_codes.join('、') || '无阻断项') + '）',
      '- 色彩标定：' + (rec.color_calib.pass ? '通过' : '未通过') +
        '（版本 ' + (rec.color_calib.version || '未填') + '）',
      '- 双人盲标：kappa ' + (rec.double_blind.kappa === null ? '未录入' : rec.double_blind.kappa) +
        ' / 覆盖 ' + (rec.double_blind.coverage_ratio * 100).toFixed(0) + '%',
      '',
      '## 交付前必做',
      '1. 训练集划分须按棚号 8:1:1，禁止同一观测的相邻帧跨集（§15.2）。',
      '2. 未过判读资格（eligible_for_trainset=false）的帧只能作审计样本。',
      '3. 色彩标定未通过的帧，B / B2 / B3 颜色类判据记 9，不得用于色差训练。'
    ].join('\n') + '\n';
  }

  function sha256Hex(buf) {
    if (!(window.crypto && crypto.subtle)) return Promise.resolve(null);
    return crypto.subtle.digest('SHA-256', buf).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    });
  }

  function writeNested(root, path, content) {
    var parts = path.split('/');
    var name = parts.pop();
    var p = Promise.resolve(root);
    parts.forEach(function (d) {
      p = p.then(function (h) { return h.getDirectoryHandle(d, { create: true }); });
    });
    return p.then(function (h) {
      return h.getFileHandle(name, { create: true })
        .then(function (fh) { return fh.createWritable(); })
        .then(function (w) {
          return w.write(new Blob([content])).then(function () { return w.close(); });
        });
    });
  }

  function exportPackage() {
    if (blockedByGate()) return;
    if (!outDirHandle) {
      toast('请先设置输出目录：数据包要建 images/ annotations/ calib/ 子目录');
      return;
    }
    var rec = buildRecord();
    var coco = buildCoco();
    var pkg = [rec.pond_id || 'pond', rec.obs_id || 'obs', rec.frame_id];
    var rootName = 'pkg_' + pkg.join('_');
    var files = {};
    files['annotations/' + rec.frame_id + '.json'] = JSON.stringify(rec, null, 2);
    files['annotations/coco_' + rec.frame_id + '.json'] = JSON.stringify(coco, null, 2);
    files['metadata/metadata.csv'] = buildMetadataCsv(rec);
    files['calib/geometry.json'] = JSON.stringify(rec.calibrated, null, 2);
    files['calib/color.json'] = JSON.stringify(rec.color_calib, null, 2);
    files['README.md'] = buildReadme(rec);

    var hashes = [];
    var chain = Promise.resolve(outDirHandle.getDirectoryHandle(rootName, { create: true }));

    Object.keys(files).forEach(function (path) {
      chain = chain.then(function (root) {
        return sha256Hex(new TextEncoder().encode(files[path])).then(function (hex) {
          if (hex) hashes.push([path, hex]);
          return writeNested(root, path, files[path]);
        });
      });
    });

    /* 原始帧：拷进 images/ 并一并校验 */
    chain = chain.then(function (root) {
      return fetch('assets/frame_045.jpg').then(function (r) { return r.arrayBuffer(); })
        .then(function (ab) {
          return sha256Hex(ab).then(function (hex) {
            if (hex) hashes.push(['images/frame_045.jpg', hex]);
            return writeNested(root, 'images/frame_045.jpg', ab);
          });
        }).catch(function () {
          toast('原始帧拷贝失败（素材缺失），数据包其余部分已写入');
        });
    });

    chain.then(function (root) {
      var sum = hashes.map(function (h) { return h[1] + '  ' + h[0]; }).join('\n') + '\n';
      return writeNested(root, 'checksums.sha256', sum);
    }).then(function () {
      render();
      toast('数据包已写入 ' + outDirHandle.name + '/' + rootName + ' · ' + Object.keys(files).length + ' 个文件 + 校验表');
    }).catch(function (e) {
      console.error(e);
      toast('数据包写入失败：' + ((e && e.name) || e));
    });
  }

  $('btnPackage').addEventListener('click', exportPackage);

  $('btnExport').addEventListener('click', function () {
    if (blockedByGate()) return;
    var rec = buildRecord();
    download(rec, 'S09_anno_' + FRAME_ID + '.json').then(function (viaDir) {
      if (!viaDir) toast('已导出标注记录 · ' + rec.objects.length + ' 个对象 · ' + rec.admission.usable_as.join('/'));
    });
  });

  $('btnCoco').addEventListener('click', function () {
    if (blockedByGate()) return;
    var coco = buildCoco();
    download(coco, 'coco_' + FRAME_ID + '.json').then(function (viaDir) {
      if (!viaDir) toast('已导出 COCO · ' + coco.annotations.length + ' 条标注 · 5 类检测 + 群体分割');
    });
  });

  $('btnReuse').addEventListener('click', function () {
    snapshot();
    state.reuse = { from: 45, to: TOTAL_FRAMES, applied: true, scope: 'S01+R+I' };
    render();
    toast('几何已复用至 45–' + TOTAL_FRAMES + ' 帧 · 仅帧级标签逐帧重标');
  });

  $('btnSave').addEventListener('click', function () {
    var f = frames[curIdx];
    if (!f) { toast('先批量导入素材再保存'); return; }
    if (f.verdict === 'bad') {
      stageWarn.hidden = false;
      toast('当前帧 f' + (curIdx + 1) + ' 在不合格段（' + f.reason + '）· 禁止保存标注');
      return;
    }
    var m = render();
    toast('已保存 · f' + (curIdx + 1) + ' · px/cm ' + m.pxcm.toFixed(1));
  });

  $('btnSkip').addEventListener('click', function () {
    toast('本帧已跳过 · 原因写入 S09 并计入剔除统计');
  });

  $('btnIssue').addEventListener('click', function () {
    toast('已生成问题工单 · 回传现场采集人员');
  });

  /* 顶栏「批量 AI 预标注」的监听在时间轴模块里注册（只处理稳定窗帧） */

  /* ============ 向导模式（3 步） ============ */

  var wizard = { on: false, step: 1 };

  function showWizardStep(n) {
    wizard.step = n;
    Array.prototype.forEach.call(document.querySelectorAll('.wz-step'), function (s) {
      s.hidden = Number(s.dataset.step) !== n;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.wz-dots i'), function (d, i) {
      d.className = i === n - 1 ? 'on' : (i < n - 1 ? 'done' : '');
    });
  }

  function setWizard(on) {
    wizard.on = on;
    document.body.classList.toggle('wizard', on);
    $('wizardPanel').hidden = !on;
    $('btnWizardMode').classList.toggle('on', on);
    $('btnWizardMode').textContent = on ? '退出向导' : '向导模式';
    try { localStorage.setItem('annotator.wizard', on ? '1' : '0'); } catch (e) {}
    if (on) { showWizardStep(1); render(); }
  }

  /* 第 1 / 3 步的实时读数：由 render() 每次调用 */
  function updateWizard(m) {
    if (!wizard.on) return;
    var ok = m.pxcm >= BASE_TIER;
    var pxEl = $('wzPxcm');
    pxEl.textContent = m.pxcm.toFixed(1);
    pxEl.className = ok ? 'ok' : 'bad';
    $('wzS1Note').textContent = ok
      ? '已达基础档（≥10），个体判据可判。'
      : '未达 10 px/cm：个体判据会被锁死，本帧只能出群体级标签。请重新对准四角，或向现场要实测边长。';
    $('wzNext1').disabled = !ok;

    $('wzObjN').textContent = (4 + 1 + state.rope.length + state.inst.length + state.feed.length) + ' 个对象';
    var gs = gateState(m);
    var adm = $('wzAdmission');
    adm.textContent = gs.eligible
      ? (gs.color_calibrated ? '是 · 可进训练集' : '是 · 仅几何/计数类')
      : '否 · 仅审计';
    adm.className = gs.eligible ? 'ok' : 'bad';
    $('wzAdmNote').textContent = gs.eligible
      ? (gs.color_calibrated
          ? '已过判读资格且色彩标定 ΔE00 达阈值，本帧可进训练集。'
          : '已过判读资格，但色彩标定未通过（' + gs.color_calib.reasons.join('、') + '）：几何与计数类可进训练集，颜色类仍记 9。')
      : '未过判读资格（' + gs.reason_codes.join('、') + '），按规程只能作审计样本，不得进训练集。需现场同时满足固定机位 / 稳定期 / 采样率三项。';
  }

  function fillWizardResult() {
    var labs = readLabels();
    $('wzP').textContent = labs.P || '—';
    $('wzA5').textContent = labs.A5 || '—';
    $('wzFeed').textContent = state.feed.length + ' 个';
    $('wzTray').textContent = state.trayShape
      ? (state.trayShape === 'square' ? '方形' : '圆形')
      : '未识别';
    $('wzResult').hidden = false;
    $('wzAccept').disabled = false;
    $('wzNext2').hidden = false;
  }

  $('btnWizardMode').addEventListener('click', function () { setWizard(!wizard.on); });
  $('wzNext1').addEventListener('click', function () { showWizardStep(2); });
  $('wzNext2').addEventListener('click', function () { showWizardStep(3); });
  $('wzAccept').addEventListener('click', function () { showWizardStep(3); });
  $('wzBackFull').addEventListener('click', function () {
    setWizard(false);
    toast('已切回完整模式：右侧六维判据可直接改，左侧类目可补框');
  });
  $('wzExportS09').addEventListener('click', function () { $('btnExport').click(); });
  $('wzExportCoco').addEventListener('click', function () { $('btnCoco').click(); });
  $('wzRestart').addEventListener('click', function () {
    showWizardStep(1);
    toast('已回到第 1 步：换一帧后重新对准料台');
  });
  $('wzRunAI').addEventListener('click', function () {
    var b = $('wzRunAI');
    b.disabled = true;
    b.classList.add('loading');
    b.textContent = '预标注中…（约 1 分钟）';
    runAIPreannotate().then(function (ok) {
      b.disabled = false;
      b.classList.remove('loading');
      b.textContent = ok ? '重新预标注' : '重试 AI 预标注';
      if (ok) fillWizardResult();
    });
  });

  try {
    if (localStorage.getItem('annotator.wizard') === '1') setWizard(true);
  } catch (e) {}

  /* ============ 素材导入 · 帧评估 · 时间轴 ============ */

  var ruler = $('ruler');
  var playhead = $('playhead');
  var frameLabel = playhead.querySelector('span');
  var ticks = ruler.querySelector('.tl-ticks');

  var frames = [];             /* { url,label,w,h,stats,verdict,reason,anno,pred } */
  var curIdx = -1;
  var film = { name: '', kind: 'none', fps: null };
  var importing = false;
  var aiBusy = false;
  var prevGray = null;         /* 评估用：前一张 64×64 灰度 */
  var EXTRACT_FPS = 5;
  var EXTRACT_MAX = 200;
  var MAX_EDGE = 1920;

  /* 初始几何作为整段复用的默认值；每帧可各自保存一份人工/预标注结果 */
  var BASE_ANNO = captureAnno();

  function captureAnno() {
    return JSON.parse(JSON.stringify({
      corners: state.corners,
      school: state.school,
      inst: state.inst,
      feed: state.feed,
      rope: state.rope,
      edited: state.edited,
      removed: state.removed,
      reuse: state.reuse,
      trayOutline: state.trayOutline,
      trayShape: state.trayShape,
      labels: readLabels()
    }));
  }

  function applyLabels(labs) {
    Object.keys(labs || {}).forEach(function (g) {
      var row = document.querySelector('.optrow[data-group="' + g + '"]');
      if (!row) return;
      Array.prototype.forEach.call(row.querySelectorAll('button'), function (b) {
        b.classList.toggle('on', b.textContent.trim() === String(labs[g]));
      });
    });
  }

  function restoreAnno(src) {
    var a = JSON.parse(JSON.stringify(src || BASE_ANNO));
    state.corners = a.corners;
    state.school = a.school;
    state.inst = a.inst;
    state.feed = a.feed;
    state.rope = a.rope;
    state.edited = a.edited || {};
    state.removed = a.removed || [];
    state.reuse = a.reuse || null;
    state.trayOutline = a.trayOutline || null;
    state.trayShape = a.trayShape || null;
    state.sel = null;
    applyLabels(a.labels);
  }

  /* 新帧第一次进入时，把默认几何按真实分辨率等比缩放，避免角点跑出画面 */
  function annoForFrame(f) {
    if (f.anno) return f.anno;
    var a = JSON.parse(JSON.stringify(BASE_ANNO));
    var sx = (f.w || 1440) / 1440;
    var sy = (f.h || 1920) / 1920;
    if (Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001) {
      a.corners.forEach(function (p) { p.x *= sx; p.y *= sy; });
      a.school.forEach(function (p) { p.x *= sx; p.y *= sy; });
      a.inst.forEach(function (o) { o.x *= sx; o.y *= sy; o.w *= sx; o.h *= sy; });
      a.feed.forEach(function (o) { o.x *= sx; o.y *= sy; });
      a.rope.forEach(function (r) { r.x1 *= sx; r.y1 *= sy; r.x2 *= sx; r.y2 *= sy; });
      if (Array.isArray(a.trayOutline) && a.trayOutline.length) {
        a.trayOutline = a.trayOutline.map(function (p) {
          return (Array.isArray(p) && typeof p[0] === 'number') ? [p[0] * sx, p[1] * sy] : p;
        });
      }
    }
    return a;
  }

  /* ---------- 画面评估：64×64 灰度 ---------- */

  function sampleGray(drawable) {
    var cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    var ctx = cv.getContext('2d');
    ctx.drawImage(drawable, 0, 0, 64, 64);
    var d = ctx.getImageData(0, 0, 64, 64).data;
    var g = new Float32Array(64 * 64);
    for (var i = 0, k = 0; k < g.length; k++, i += 4) {
      g[k] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    }
    return g;
  }

  function statsFromGray(g, prev) {
    var sum = 0, n = 0;
    for (var y = 1; y < 63; y++) {
      for (var x = 1; x < 63; x++) {
        var i = y * 64 + x;
        var lap = g[i - 1] + g[i + 1] + g[i - 64] + g[i + 64] - 4 * g[i];
        sum += lap * lap;
        n++;
      }
    }
    var bright = 0, over = 0;
    for (var j = 0; j < g.length; j++) {
      bright += g[j];
      if (g[j] > 235) over++;
    }
    bright /= g.length;
    over = over / g.length;

    var motion = 0;
    if (prev) {
      var diff = 0;
      for (var q = 0; q < g.length; q++) diff += Math.abs(g[q] - prev[q]);
      motion = diff / g.length;
    }
    return { sharp: n ? sum / n : 0, motion: motion, bright: bright, over: over };
  }

  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* stats 可选：file:// 下画布被污染，只能由调用方给合成值 */
  function addFrame(url, label, w, h, drawable, stats) {
    if (!stats) {
      var gray = sampleGray(drawable);
      stats = statsFromGray(gray, prevGray);
      prevGray = gray;
    }
    frames.push({
      url: url, label: label, w: w || 1440, h: h || 1920,
      stats: stats, verdict: 'ok', reason: '', anno: null, pred: null, predApplied: false
    });
  }

  /* 自适应阈值：以全片中位数为基准，不写死 */
  function computeVerdicts() {
    var medSh = median(frames.map(function (f) { return f.stats.sharp; }));
    var medMd = median(frames.map(function (f) { return f.stats.motion; }));
    frames.forEach(function (f) {
      var s = f.stats, r = [];
      /* 全片画面完全一致时运动中位数为 0，该条阈值不具判别力 */
      if (medMd > 0.5 && s.motion > medMd * 1.5) r.push('运动超限');
      if (medSh > 0 && s.sharp < medSh * 0.6) r.push('锐度不足');
      if (s.over > 0.05) r.push('过曝');
      if (s.bright < 25) r.push('过暗');
      f.verdict = r.length ? 'bad' : 'ok';
      f.reason = r.join(' / ');
    });
  }

  /* ---------- 切帧 ---------- */

  function loadFrameImage(url) {
    return new Promise(function (res, rej) {
      if (!url) { rej(new Error('帧地址为空')); return; }
      frameImg.onload = function () { frameImg.onload = frameImg.onerror = null; res(); };
      frameImg.onerror = function () { frameImg.onload = frameImg.onerror = null; rej(new Error('图片解码失败')); };
      frameImg.src = url;
      if (frameImg.complete && frameImg.naturalWidth) {
        frameImg.onload = frameImg.onerror = null;
        res();
      }
    });
  }

  function updateFrameChrome() {
    var f = frames[curIdx];
    document.body.classList.toggle('no-media', frames.length === 0);
    if (stageEmpty) stageEmpty.hidden = frames.length > 0;
    chipFrameQ.className = 'chip' + (f ? (f.verdict === 'bad' ? ' bad' : ' ok') : '');
    chipFrameQ.textContent = f
      ? (f.verdict === 'bad' ? '不合格段 · 不可标注' : '稳定窗 · 可标注')
      : '未导入';
    chipFrameQ.title = f
      ? '锐度 ' + Math.round(f.stats.sharp) + ' · 运动 ' + f.stats.motion.toFixed(1) +
        ' · 亮度 ' + Math.round(f.stats.bright) + (f.reason ? ' · ' + f.reason : '')
      : '';
    if (stageWarn) {
      stageWarn.hidden = !(f && f.verdict === 'bad');
      if (f && f.verdict === 'bad') {
        stageWarn.textContent = '该帧在不合格段（' + f.reason + '）· 不可用于标注';
      }
    }
  }

  function updatePlayhead() {
    if (!frames.length || curIdx < 0) {
      playhead.hidden = true;
      Array.prototype.forEach.call(tlFrames.querySelectorAll('.thumb.cur'), function (t) {
        t.classList.remove('cur');
      });
      return;
    }
    playhead.hidden = false;
    playhead.style.left = ((curIdx + 0.5) / frames.length * 100).toFixed(3) + '%';
    frameLabel.textContent = String(curIdx + 1);
    Array.prototype.forEach.call(tlFrames.querySelectorAll('.thumb'), function (t) {
      t.classList.toggle('cur', Number(t.getAttribute('data-idx')) === curIdx);
    });
  }

  function showFrame(idx, opts) {
    opts = opts || {};
    if (idx < 0 || idx >= frames.length) return Promise.resolve();
    if (curIdx >= 0 && frames[curIdx]) frames[curIdx].anno = captureAnno();

    var f = frames[idx];
    curIdx = idx;
    IMG_W = f.w || 1440;
    IMG_H = f.h || 1920;
    overlaySvg.setAttribute('viewBox', '0 0 ' + IMG_W + ' ' + IMG_H);
    dimOut.textContent = IMG_W + ' × ' + IMG_H;
    framePosOut.textContent = 'frame ' + (idx + 1) + ' / ' + frames.length;
    frameIdOut.textContent = f.label;

    restoreAnno(annoForFrame(f));
    history.length = 0;
    activeVert = null;
    render();
    updatePlayhead();
    updateFrameChrome();

    return loadFrameImage(f.url).then(function () {
      if (f.verdict === 'bad') {
        toast('f' + (idx + 1) + ' 在不合格段（' + f.reason + '）· 不可用于标注');
      } else if (!opts.quiet) {
        toast('f' + (idx + 1) + ' · 稳定窗');
      }
    }).catch(function (e) {
      toast('帧加载失败：' + ((e && e.message) || e));
    });
  }

  /* ---------- 时间轴 ---------- */

  function segName(f) { return f.verdict === 'ok' ? '稳定窗' : '不合格段'; }

  function renderTimeline() {
    Array.prototype.slice.call(ruler.querySelectorAll('.seg, .key, .tl-empty'))
      .forEach(function (n) { n.remove(); });

    var n = frames.length;
    if (!n) {
      ruler.classList.add('empty');
      playhead.hidden = true;
      ticks.textContent = '';
      var e = document.createElement('div');
      e.className = 'tl-empty';
      e.textContent = '导入素材后自动计算稳定窗';
      ruler.insertBefore(e, playhead);
      return;
    }

    ruler.classList.remove('empty');
    var i = 0;
    while (i < n) {
      var j = i;
      while (j + 1 < n && frames[j + 1].verdict === frames[i].verdict) j++;
      var seg = document.createElement('div');
      seg.className = 'seg ' + frames[i].verdict;
      seg.style.left = (i / n * 100) + '%';
      seg.style.width = ((j - i + 1) / n * 100) + '%';
      seg.title = 'f' + (i + 1) + '–f' + (j + 1) + ' · ' + segName(frames[i]);
      ruler.insertBefore(seg, playhead);

      if (frames[i].verdict === 'ok') {
        var best = i;
        for (var k = i + 1; k <= j; k++) {
          if (frames[k].stats.sharp > frames[best].stats.sharp) best = k;
        }
        var key = document.createElement('div');
        key.className = 'key';
        key.style.left = ((best + 0.5) / n * 100).toFixed(3) + '%';
        key.title = '关键帧 f' + (best + 1) + ' · 锐度 ' + Math.round(frames[best].stats.sharp);
        ruler.insertBefore(key, playhead);
      }
      i = j + 1;
    }

    ticks.textContent = '';
    for (var q = 0; q < 5; q++) {
      var span = document.createElement('span');
      span.textContent = tickLabel(q / 4, n);
      ticks.appendChild(span);
    }
  }

  function tickLabel(pct, n) {
    if (film.kind !== 'image' && film.fps) {
      return (pct * n / film.fps).toFixed(1) + 's';
    }
    return 'f' + Math.max(1, Math.round(pct * (n - 1)) + 1);
  }

  function renderFilmMeta() {
    var n = frames.length;
    if (!n) {
      tlTitle.textContent = '时间轴 · 未导入素材';
      tlMeta.textContent = '—';
      return;
    }
    tlTitle.textContent = '时间轴 · ' + film.name;
    tlMeta.textContent = film.kind === 'image'
      ? n + ' 张'
      : n + ' 帧 · ' + film.fps + ' fps · ' + (n / film.fps).toFixed(2) + ' s';
  }

  function renderThumbs() {
    Array.prototype.slice.call(tlFrames.querySelectorAll('.thumb'))
      .forEach(function (t) { t.remove(); });
    var n = frames.length;
    if (!n) {
      tlNote.textContent = '导入素材后生成缩略帧';
      return;
    }
    var count = Math.min(6, n);
    for (var k = 0; k < count; k++) {
      var idx = count === 1 ? 0 : Math.round(k * (n - 1) / (count - 1));
      var d = document.createElement('div');
      d.className = 'thumb';
      d.setAttribute('data-idx', idx);
      var im = document.createElement('img');
      im.src = frames[idx].url;
      im.alt = frames[idx].label;
      var em = document.createElement('em');
      em.textContent = 'f' + (idx + 1);
      d.appendChild(im);
      d.appendChild(em);
      tlFrames.insertBefore(d, tlNote);
    }
    tlNote.textContent = '段内只标 1 次：几何整段复用，帧级标签写 S09';
  }

  /* ---------- 导入管线 ---------- */

  function loadImageUrl(url) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('图片无法解码：' + url)); };
      im.src = url;
    });
  }

  function readImageFile(file) {
    var url = URL.createObjectURL(file);
    return loadImageUrl(url).then(function (im) {
      return { url: url, img: im };
    }).catch(function (e) {
      URL.revokeObjectURL(url);
      throw e;
    });
  }

  function canvasToBlobUrl(canvas) {
    return new Promise(function (res) {
      canvas.toBlob(function (b) {
        res(b ? URL.createObjectURL(b) : null);
      }, 'image/jpeg', 0.9);
    });
  }

  function probeVideo(url) {
    return new Promise(function (res, rej) {
      var v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      var timer = setTimeout(function () { fail(new Error('视频加载超时（浏览器无法解码该格式）')); }, 15000);
      function fail(e) {
        clearTimeout(timer);
        v.onloadedmetadata = v.onerror = null;
        rej(e);
      }
      v.onloadedmetadata = function () {
        clearTimeout(timer);
        v.onloadedmetadata = v.onerror = null;
        res(v);
      };
      v.onerror = function () { fail(new Error('视频无法解码（浏览器缺少该编码支持）')); };
      v.src = url;
    });
  }

  function seekVideo(v, t) {
    return new Promise(function (res, rej) {
      var timer = setTimeout(function () {
        v.removeEventListener('seeked', on);
        rej(new Error('视频抽帧超时（seek 无响应）'));
      }, 8000);
      function on() {
        clearTimeout(timer);
        v.removeEventListener('seeked', on);
        res();
      }
      v.addEventListener('seeked', on);
      try {
        v.currentTime = Math.max(0, Math.min(v.duration - 0.02, t));
      } catch (e) {
        clearTimeout(timer);
        rej(e);
      }
    });
  }

  /* 浏览器端抽帧：5 fps、最多 200 帧，超出均匀降采样；最长边 >1920 等比缩小 */
  function extractVideo(file) {
    var url = URL.createObjectURL(file);
    return probeVideo(url).then(function (v) {
      var dur = v.duration;
      if (!isFinite(dur) || dur <= 0) throw new Error('视频时长无效：' + file.name);
      var vw = v.videoWidth || 2, vh = v.videoHeight || 2;
      var wanted = Math.min(EXTRACT_MAX, Math.max(1, Math.round(dur * EXTRACT_FPS)));
      var step = dur / wanted;
      var sc = Math.min(1, MAX_EDGE / Math.max(vw, vh));
      var cv = document.createElement('canvas');
      cv.width = Math.max(2, Math.round(vw * sc));
      cv.height = Math.max(2, Math.round(vh * sc));
      var ctx = cv.getContext('2d');
      var chain = Promise.resolve();
      for (var i = 0; i < wanted; i++) {
        (function (k) {
          chain = chain.then(function () {
            return seekVideo(v, k * step + Math.min(0.05, step / 2))
              .then(function () {
                ctx.drawImage(v, 0, 0, cv.width, cv.height);
                return canvasToBlobUrl(cv);
              })
              .then(function (blobUrl) {
                if (!blobUrl) throw new Error('抽帧编码失败：' + file.name);
                addFrame(blobUrl, file.name + ' · f' + (k + 1), cv.width, cv.height, cv);
              });
          });
        })(i);
      }
      return chain.then(function () {
        v.removeAttribute('src');
        try { v.load(); } catch (e) {}
        return wanted;
      });
    }).catch(function (e) {
      URL.revokeObjectURL(url);
      throw e;
    });
  }

  function resetFrames() {
    frames.forEach(function (f) {
      if (f.url && f.url.indexOf('blob:') === 0) URL.revokeObjectURL(f.url);
    });
    frames = [];
    curIdx = -1;
    prevGray = null;
    film = { name: '', kind: 'none', fps: null };
    restoreAnno(BASE_ANNO);
  }

  function commitImport(name, kind, fps) {
    film.name = name;
    film.kind = kind;
    film.fps = fps;
    computeVerdicts();
    curIdx = -1;
    renderTimeline();
    renderFilmMeta();
    renderThumbs();
    updateFrameChrome();
    proofHint.hidden = true;
    showFrame(0, { silent: true, quiet: true });
  }

  function importImages(files) {
    var sorted = files.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, 'zh-Hans', { numeric: true });
    });
    var chain = Promise.resolve();
    sorted.forEach(function (file) {
      chain = chain.then(function () {
        return readImageFile(file).then(function (r) {
          addFrame(r.url, file.name, r.img.naturalWidth, r.img.naturalHeight, r.img);
        }).catch(function (e) {
          console.warn('图片导入失败', e);
        });
      });
    });
    return chain;
  }

  function importVideos(files) {
    var chain = Promise.resolve();
    var failed = 0, errMsg = '';
    files.forEach(function (file) {
      chain = chain.then(function () {
        return extractVideo(file).catch(function (e) {
          failed++;
          errMsg = (e && e.message) || String(e);
          console.warn('视频抽帧失败', e);
        });
      });
    });
    return chain.then(function () { return { failed: failed, errMsg: errMsg }; });
  }

  function handleFiles(list) {
    if (importing) { toast('正在导入，请稍候…'); return; }
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    var images = files.filter(function (f) { return /^image\//.test(f.type); });
    var videos = files.filter(function (f) { return /^video\//.test(f.type); });
    if (!images.length && !videos.length) { toast('未识别到图片或视频文件'); return; }

    importing = true;
    resetFrames();
    renderTimeline();
    renderFilmMeta();
    renderThumbs();
    updateFrameChrome();
    toast('正在导入 ' + files.length + ' 个文件…');

    importImages(images)
      .then(function () {
        return importVideos(videos).then(function (vr) {
          importing = false;
          if (!frames.length) {
            toast('导入失败：没有可用的帧' + (vr.errMsg ? '（' + vr.errMsg + '）' : ''));
            return;
          }
          var name = videos.length
            ? (videos.length === 1 ? videos[0].name : videos[0].name + ' 等 ' + videos.length + ' 个视频')
            : (frames.length === 1 ? frames[0].label : frames[0].label + ' 等 ' + frames.length + ' 张');
          commitImport(name, videos.length ? 'video' : 'image', videos.length ? EXTRACT_FPS : null);
          var bad = frames.filter(function (f) { return f.verdict === 'bad'; }).length;
          toast('已导入 ' + frames.length + ' 帧 · 稳定窗 ' + (frames.length - bad) + ' · 不合格 ' + bad +
            (vr.failed ? ' · ' + vr.failed + ' 个视频抽帧失败：' + vr.errMsg.slice(0, 60) : ''));
        });
      })
      .catch(function (e) {
        importing = false;
        console.error(e);
        toast('导入失败：' + ((e && e.message) || e));
      });
  }

  /* 示例：同一张内置图走同一套管线生成 12 帧（含模糊/过暗帧，用于演示绿红分段与游标） */
  function loadSample() {
    if (importing) { toast('正在导入，请稍候…'); return Promise.resolve(); }
    importing = true;
    resetFrames();
    renderTimeline();
    renderFilmMeta();
    renderThumbs();
    updateFrameChrome();
    toast('正在生成 12 帧示例…');

    var profiles = [
      {}, {}, {}, { blur: true }, { blur: true }, {}, {},
      { dark: true }, { blur: true }, { blur: true }, {}, {}
    ];

    var usedFallback = false;

    return loadImageUrl('assets/frame_045.jpg').then(function (im) {
      var sc = Math.min(1, MAX_EDGE / Math.max(im.naturalWidth, im.naturalHeight));
      var w = Math.round(im.naturalWidth * sc);
      var h = Math.round(im.naturalHeight * sc);

      /* 双击 index.html 用 file:// 打开时，画进 canvas 的本地图片会污染画布：
         getImageData 取不到像素、toBlob 直接抛 SecurityError。
         此时降级为"原图地址 + 合成质量值"，仍生成 12 帧，绿红分段与游标照常演示。 */
      var tainted = false;
      try {
        var probe = document.createElement('canvas');
        probe.width = 4; probe.height = 4;
        var pctx = probe.getContext('2d');
        pctx.drawImage(im, 0, 0, 4, 4);
        pctx.getImageData(0, 0, 1, 1);
      } catch (e) {
        tainted = true;
      }
      usedFallback = tainted;

      var chain = Promise.resolve();
      profiles.forEach(function (p, i) {
        chain = chain.then(function () {
          var label = 'f' + ('0' + (i + 1)).slice(-2);
          if (tainted) {
            var fake;
            if (p.dark) fake = { sharp: 200, motion: 1, bright: 10, over: 0 };
            else if (p.blur) fake = { sharp: 200, motion: 1, bright: 120, over: 0.005 };
            else fake = { sharp: 900, motion: 1, bright: 120, over: 0.005 };
            addFrame(im.src, label, w, h, null, fake);
            return;
          }
          var cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          var ctx = cv.getContext('2d');
          if (p.blur) {
            var small = document.createElement('canvas');
            small.width = Math.max(2, Math.round(w * 0.045));
            small.height = Math.max(2, Math.round(h * 0.045));
            small.getContext('2d').drawImage(im, 0, 0, small.width, small.height);
            ctx.drawImage(small, 0, 0, w, h);
          } else {
            ctx.drawImage(im, 0, 0, w, h);
          }
          if (p.dark) {
            ctx.fillStyle = 'rgba(0,0,0,0.9)';
            ctx.fillRect(0, 0, w, h);
          }
          return canvasToBlobUrl(cv).then(function (url) {
            if (!url) throw new Error('示例帧编码失败');
            addFrame(url, label, w, h, cv);
          });
        });
      });
      return chain;
    }).then(function () {
      importing = false;
      commitImport('示例 · frame_045.jpg', 'video', EXTRACT_FPS);
      toast(usedFallback
        ? '示例已载入 12 帧（本地 file:// 打开，模糊/过暗帧用合成质量值演示）'
        : '示例已载入 12 帧 · 仅用于演示时间轴与游标切换');
    }).catch(function (e) {
      importing = false;
      console.error(e);
      toast('示例载入失败：' + ((e && e.message) || e));
    });
  }

  /* ---------- 游标切帧 ---------- */

  var seeking = false;

  function seekTo(clientX) {
    if (!frames.length) return;
    var box = ruler.getBoundingClientRect();
    var pct = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    var idx = Math.min(frames.length - 1, Math.floor(pct * frames.length));
    if (idx !== curIdx) showFrame(idx, { quiet: true });
  }

  ruler.addEventListener('pointerdown', function (e) {
    if (!frames.length) { toast('先批量导入素材'); return; }
    seeking = true;
    try { ruler.setPointerCapture(e.pointerId); } catch (err) {}
    seekTo(e.clientX);
  });
  ruler.addEventListener('pointermove', function (e) {
    if (seeking) seekTo(e.clientX);
  });
  ruler.addEventListener('pointerup', function () { seeking = false; });
  ruler.addEventListener('pointercancel', function () { seeking = false; });

  /* ---------- 批量 AI 预标注（只处理稳定窗帧） ---------- */

  function applyPred(f) {
    if (!f || !f.pred || f.predApplied) return;
    snapshot();
    applyAIPreannotate(f.pred);
    f.predApplied = true;
    render();
  }

  function batchPreannotate() {
    if (!window.XMLHttpRequest) { toast('浏览器不支持 XHR'); return Promise.resolve(); }
    if (!frames.length) { toast('先批量导入素材'); return Promise.resolve(); }
    if (aiBusy) return Promise.resolve();

    var targets = [];
    frames.forEach(function (f, i) { if (f.verdict === 'ok') targets.push(i); });
    if (!targets.length) { toast('没有稳定窗帧可预标注：全部帧都在不合格段'); return Promise.resolve(); }

    var btn = $('btnAIPreannotate');
    aiBusy = true;
    btn.disabled = true;
    btn.classList.add('loading');
    btn.textContent = '0/' + targets.length;
    proofHint.hidden = true;

    var okN = 0, failN = 0, lastErr = '';
    var chain = Promise.resolve();

    targets.forEach(function (idx, k) {
      chain = chain.then(function () {
        btn.textContent = (k + 1) + '/' + targets.length;
        return showFrame(idx, { silent: true, quiet: true })
          .then(function () { return aiPreannotateFrame(); })
          .then(function (ai) {
            var f = frames[idx];
            f.pred = ai;
            f.predApplied = false;
            applyPred(f);
            okN++;
          })
          .catch(function (err) {
            failN++;
            lastErr = (err && err.message) || String(err);
            console.warn('AI 预标注失败 f' + (idx + 1), err);
          });
      });
    });

    return chain.then(function () {
      aiBusy = false;
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.textContent = '批量 AI 预标注';
      proofHint.hidden = okN === 0;
      if (!okN) {
        toast('批量预标注失败：' + (lastErr || '没有可用结果').slice(0, 130));
      } else {
        toast('已完成 ' + okN + ' 帧' + (failN ? '，其中 ' + failN + ' 帧失败：' + lastErr.slice(0, 70) : '') +
          ' · 现在逐帧人工微调');
      }
      render();
    });
  }

  /* ---------- 入口按钮 ---------- */

  function openImport() {
    fileInput.value = '';
    fileInput.click();
  }

  $('btnImport').addEventListener('click', openImport);
  $('btnEmptyImport').addEventListener('click', openImport);
  $('btnEmptySample').addEventListener('click', loadSample);
  fileInput.addEventListener('change', function () { handleFiles(fileInput.files); });

  $('btnAIPreannotate').addEventListener('click', batchPreannotate);

  /* ---------- 初始空态 ---------- */

  function initMedia() {
    dimOut.textContent = '— × —';
    framePosOut.textContent = 'frame — / —';
    renderTimeline();
    renderFilmMeta();
    updateFrameChrome();
  }

  activateTool('select');
  applyView();
  initMedia();
  render();

  if (location.hash.indexOf('sample') >= 0) loadSample();
  window.addEventListener('hashchange', function () {
    if (location.hash.indexOf('sample') >= 0) loadSample();
  });

})();
