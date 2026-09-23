(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const editor = document.querySelector('[data-graph-editor]');
    if (!editor || !window.MotionGraphEngine) return;

    const canvas = editor.querySelector('[data-graph-canvas]');
    const context = canvas.getContext('2d');
    const graphTypeSelect = editor.querySelector('[data-graph-type]');
    const graphModeToggle = editor.querySelector('[data-graph-mode-toggle]');
    const expressionToggle = editor.querySelector('[data-expression-toggle]');
    const resetButton = editor.querySelector('[data-graph-reset]');
    const parametersPanel = editor.querySelector('[data-graph-parameters]');
    const applyButton = editor.querySelector('[data-graph-apply]');
    const contextStatus = editor.querySelector('[data-graph-context]');
    const stateStatus = editor.querySelector('[data-graph-state]');
    let state = {
      mode: 'value',
      graphType: 'bezier',
      graph: window.MotionGraphEngine.createDefinition('bezier'),
      expressionMode: 'keyframe',
      keyframeCount: 2,
      playheadProgress: 0,
      draggingHandle: null,
      dragStart: null
    };

    function resizeCanvas() {
      const bounds = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawGraph();
    }

    function getGraphGeometry(rangePoints) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const padding = { left: 30, right: 14, top: 20, bottom: 22 };
      const baseMinimum = -0.2;
      const baseMaximum = 1.2;
      const points = rangePoints || window.MotionGraphEngine.sample(state.graph, state.mode, 96);
      let curveMinimum = Math.min(...points.map((point) => point.value));
      let curveMaximum = Math.max(...points.map((point) => point.value));
      if (state.graph.type === 'bezier' || state.graph.type === 'custom') {
        const curve = state.graph[state.graph.type];
        curveMinimum = Math.min(curveMinimum, curve.y1, curve.y2);
        curveMaximum = Math.max(curveMaximum, curve.y1, curve.y2);
      } else if (state.graph.type === 'elastic') {
        curveMinimum = Math.min(curveMinimum, 1 - state.graph.elastic.amplitude);
        curveMaximum = Math.max(curveMaximum, 1 + state.graph.elastic.amplitude);
      } else if (state.graph.type === 'bouncing') {
        curveMinimum = Math.min(curveMinimum, 1 - state.graph.bouncing.strength);
      }
      const minimum = curveMinimum < baseMinimum
        ? Math.min(baseMinimum, curveMinimum - Math.max(0.08, Math.abs(curveMinimum) * 0.12))
        : baseMinimum;
      const maximum = curveMaximum > baseMaximum
        ? Math.max(baseMaximum, curveMaximum + Math.max(0.08, Math.abs(curveMaximum) * 0.12))
        : baseMaximum;
      const graphWidth = width - padding.left - padding.right;
      const graphHeight = height - padding.top - padding.bottom;
      return {
        width,
        height,
        padding,
        minimum,
        maximum,
        graphWidth,
        graphHeight,
        xForProgress: (value) => padding.left + value * graphWidth,
        yForValue: (value) => padding.top + (maximum - value) / (maximum - minimum) * graphHeight,
        progressForX: (value) => window.MotionGraphEngine.clamp((value - padding.left) / graphWidth, 0, 1),
        rawValueForY: (value) => maximum - (value - padding.top) / graphHeight * (maximum - minimum)
      };
    }

    function updateAxisLabels(geometry) {
      editor.querySelector('.graph-axis-y-top').textContent = `+${Math.round(geometry.maximum * 100)}%`;
      editor.querySelector('.graph-axis-y-bottom').textContent = `${Math.round(geometry.minimum * 100)}%`;
    }

    function getEditableCurve() {
      if (state.graph.type !== 'bezier' && state.graph.type !== 'custom') return null;
      return state.graph.type === 'custom' ? state.graph.custom : state.graph.bezier;
    }

    function getElasticHandles(geometry) {
      const elastic = state.graph.elastic;
      return [
        {
          name: 'elastic-period',
          x: geometry.xForProgress(window.MotionGraphEngine.clamp(elastic.period, 0.04, 1)),
          y: geometry.yForValue(1),
          color: '#f2f2f2'
        },
        {
          name: 'elastic-amplitude',
          x: geometry.xForProgress(window.MotionGraphEngine.clamp(elastic.period + 0.12, 0.12, 1)),
          y: geometry.yForValue(1 + elastic.amplitude),
          color: '#9a9a9a'
        }
      ];
    }

    function drawElasticControls(geometry) {
      if (state.graph.type !== 'elastic') return;
      const handles = getElasticHandles(geometry);
      const baseline = { x: geometry.xForProgress(0), y: geometry.yForValue(1) };

      context.strokeStyle = '#f2f2f259';
      context.lineWidth = 1;
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(baseline.x, baseline.y);
      context.lineTo(handles[0].x, handles[0].y);
      context.moveTo(handles[0].x, handles[0].y);
      context.lineTo(handles[1].x, handles[1].y);
      context.stroke();
      context.setLineDash([]);

      handles.forEach((handle) => {
        context.fillStyle = handle.color;
        context.strokeStyle = '#181818';
        context.lineWidth = 2;
        context.beginPath();
        context.arc(handle.x, handle.y, 6, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      });
    }

    function getBounceHandles(geometry) {
      const bounce = state.graph.bouncing;
      return [
        {
          name: 'bounce-count',
          x: geometry.xForProgress(window.MotionGraphEngine.clamp(bounce.bounces / 12, 0.08, 1)),
          y: geometry.yForValue(1),
          color: '#f2f2f2'
        },
        {
          name: 'bounce-strength',
          x: geometry.xForProgress(window.MotionGraphEngine.clamp(bounce.bounces / 12 + 0.1, 0.18, 1)),
          y: geometry.yForValue(1 - bounce.strength),
          color: '#9a9a9a'
        }
      ];
    }

    function drawBounceControls(geometry) {
      if (state.graph.type !== 'bouncing') return;
      const handles = getBounceHandles(geometry);
      const baseline = { x: geometry.xForProgress(0), y: geometry.yForValue(1) };

      context.strokeStyle = '#f2f2f259';
      context.lineWidth = 1;
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(baseline.x, baseline.y);
      context.lineTo(handles[0].x, handles[0].y);
      context.moveTo(handles[0].x, handles[0].y);
      context.lineTo(handles[1].x, handles[1].y);
      context.stroke();
      context.setLineDash([]);

      handles.forEach((handle) => {
        context.fillStyle = handle.color;
        context.strokeStyle = '#181818';
        context.lineWidth = 2;
        context.beginPath();
        context.arc(handle.x, handle.y, 6, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      });
    }

    function getStepHandle(geometry) {
      return {
        name: 'step-count',
        x: geometry.xForProgress(window.MotionGraphEngine.clamp(state.graph.step.steps / 32, 0.05, 1)),
        y: geometry.yForValue(1),
        color: '#f2f2f2'
      };
    }

    function drawStepControls(geometry) {
      if (state.graph.type !== 'step') return;
      const handle = getStepHandle(geometry);
      const baseline = { x: geometry.xForProgress(0), y: geometry.yForValue(1) };
      context.strokeStyle = '#f2f2f259';
      context.lineWidth = 1;
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(baseline.x, baseline.y);
      context.lineTo(handle.x, handle.y);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = handle.color;
      context.strokeStyle = '#181818';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(handle.x, handle.y, 6, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }

    function getParameterFields() {
      // Y1/Y2 (and elastic amplitude) used to allow -100..100 / 0..100, which
      // is a percentage-sized range left over from copy/pasting - the curve
      // math actually works in roughly a -1..2 fractional range (defaults are
      // 0.1, 0.9, 1.18, 1), so anything near the old extremes produced a
      // curve so distorted it was effectively unusable. -2..3 / 0..3 keeps
      // generous room for overshoot/anticipation without that cliff.
      const fields = {
        bezier: [
          ['x1', 'X1', 0, 1, 0.01], ['y1', 'Y1', -2, 3, 0.01],
          ['x2', 'X2', 0, 1, 0.01], ['y2', 'Y2', -2, 3, 0.01]
        ],
        custom: [
          ['x1', 'X1', 0, 1, 0.01], ['y1', 'Y1', -2, 3, 0.01],
          ['x2', 'X2', 0, 1, 0.01], ['y2', 'Y2', -2, 3, 0.01]
        ],
        elastic: [
          ['amplitude', 'AMP', 0, 3, 0.01], ['period', 'PERIOD', 0.02, 1, 0.01],
          ['damping', 'DAMP', 0, 20, 0.1]
        ],
        bouncing: [
          ['strength', 'STIFFNESS', 0, 1, 0.01],
          ['bounces', 'BOUNCES', 1, 12, 1]
        ],
        step: [['steps', 'STEPS', 1, 32, 1], ['hold', 'HOLD', 'floor', 'round', 'ceil']]
      };
      return fields[state.graph.type] || [];
    }

    function getParameterTarget(key) {
      return state.graph[state.graph.type][key];
    }

    function renderParameters() {
      parametersPanel.innerHTML = '';
      getParameterFields().forEach(([key, label, minimum, maximum, step]) => {
        const field = document.createElement('label');
        field.className = 'graph-parameter';
        field.innerHTML = `<span>${label}</span>`;
        const isSelect = typeof minimum === 'string';
        const input = document.createElement(isSelect ? 'select' : 'input');
        input.dataset.graphParameter = key;
        if (isSelect) {
          input.innerHTML = '<option value="floor">FLOOR</option><option value="round">ROUND</option><option value="ceil">CEIL</option>';
        } else {
          input.type = 'number';
          input.min = minimum;
          input.max = maximum;
          input.step = step;
          input.value = getParameterTarget(key);
        }
        field.appendChild(input);
        parametersPanel.appendChild(field);
      });
      parametersPanel.querySelectorAll('[data-graph-parameter]').forEach((input) => {
        const key = input.dataset.graphParameter;
        input.value = getParameterTarget(key);
        input.addEventListener('input', () => {
          const target = state.graph[state.graph.type];
          if (input.tagName === 'SELECT') {
            target[key] = input.value;
          } else {
            // Only commit once the field holds a real number - otherwise a
            // mid-edit state like "-" or "" would clamp to NaN and corrupt
            // the curve until the user finishes typing.
            const numericValue = Number(input.value);
            if (Number.isFinite(numericValue)) {
              target[key] = window.MotionGraphEngine.clamp(numericValue, Number(input.min), Number(input.max));
            }
          }
          stateStatus.textContent = `EDITING ${state.graph.type.toUpperCase()} / APPLY WHEN READY`;
          refreshGraph();
        });
      });
    }

    function syncParameterInputs() {
      parametersPanel.querySelectorAll('[data-graph-parameter]').forEach((input) => {
        input.value = getParameterTarget(input.dataset.graphParameter);
      });
    }

    function syncCurveMode() {
      const expressionOnly = state.graph.type === 'elastic' || state.graph.type === 'bouncing';
      state.mode = 'value';
      state.expressionMode = expressionOnly ? 'expression' : 'keyframe';
      graphModeToggle.textContent = 'VALUE';
      graphModeToggle.setAttribute('aria-pressed', 'false');
      graphModeToggle.disabled = expressionOnly;
      applyButton.disabled = false;
      applyButton.title = '';
      expressionToggle.textContent = expressionOnly ? 'EXPRESSION' : 'KEYFRAME';
      expressionToggle.setAttribute('aria-pressed', String(expressionOnly));
      expressionToggle.disabled = expressionOnly;
    }

    function drawEditableControls(geometry) {
      const curve = getEditableCurve();
      if (!curve) return;

      const start = { x: geometry.xForProgress(0), y: geometry.yForValue(0) };
      const end = { x: geometry.xForProgress(1), y: geometry.yForValue(1) };
      const first = { x: geometry.xForProgress(curve.x1), y: geometry.yForValue(curve.y1) };
      const second = { x: geometry.xForProgress(curve.x2), y: geometry.yForValue(curve.y2) };

      context.strokeStyle = '#f2f2f259';
      context.lineWidth = 1;
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(first.x, first.y);
      context.moveTo(end.x, end.y);
      context.lineTo(second.x, second.y);
      context.stroke();
      context.setLineDash([]);

      [first, second].forEach((point, index) => {
        context.fillStyle = index === 0 ? '#f2f2f2' : '#9a9a9a';
        context.strokeStyle = '#181818';
        context.lineWidth = 2;
        context.beginPath();
        context.arc(point.x, point.y, 5, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      });
    }

    function drawGraph() {
      const points = window.MotionGraphEngine.sample(state.graph, state.mode, 96);
      const geometry = getGraphGeometry(points);
      updateAxisLabels(geometry);
      const {
        width,
        height,
        padding,
        minimum,
        maximum,
        graphWidth,
        yForValue,
        xForProgress
      } = geometry;
      context.clearRect(0, 0, width, height);
      context.fillStyle = '#181818';
      context.fillRect(0, 0, width, height);

      context.lineWidth = 1;
      for (let index = 0; index <= 8; index += 1) {
        const x = padding.left + graphWidth * index / 8;
        context.strokeStyle = index === 0 || index === 8 ? '#444444' : '#2e2e2e';
        context.beginPath();
        context.moveTo(x, padding.top);
        context.lineTo(x, height - padding.bottom);
        context.stroke();
      }

      for (let index = 0; index <= 6; index += 1) {
        const value = minimum + (maximum - minimum) * index / 6;
        const y = yForValue(value);
        context.strokeStyle = Math.abs(value) < 0.04 ? '#666666' : '#2e2e2e';
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
      }

      context.setLineDash([4, 5]);
      context.strokeStyle = '#f2f2f233';
      context.beginPath();
      context.moveTo(padding.left, yForValue(0));
      context.lineTo(width - padding.right, yForValue(0));
      context.stroke();
      context.setLineDash([]);

      context.strokeStyle = '#f2f2f2';
      context.lineWidth = 2.25;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.beginPath();
      points.forEach((point, index) => {
        const x = xForProgress(point.progress);
        const y = yForValue(point.value);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();

      drawEditableControls(geometry);
      drawElasticControls(geometry);
      drawBounceControls(geometry);
      drawStepControls(geometry);

      const playheadX = xForProgress(state.playheadProgress);
      context.strokeStyle = '#9a9a9a';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(playheadX, padding.top);
      context.lineTo(playheadX, height - padding.bottom);
      context.stroke();
    }

    function pointerPosition(event) {
      const bounds = canvas.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    }

    function findHandle(event) {
      const geometry = getGraphGeometry();
      const pointer = pointerPosition(event);
      if (state.graph.type === 'elastic') {
        return getElasticHandles(geometry).find((handle) => (
          Math.hypot(pointer.x - handle.x, pointer.y - handle.y) < 14
        )) || null;
      }
      if (state.graph.type === 'bouncing') {
        return getBounceHandles(geometry).find((handle) => (
          Math.hypot(pointer.x - handle.x, pointer.y - handle.y) < 14
        )) || null;
      }
      if (state.graph.type === 'step') {
        const handle = getStepHandle(geometry);
        return Math.hypot(pointer.x - handle.x, pointer.y - handle.y) < 14 ? handle : null;
      }
      const curve = getEditableCurve();
      if (!curve) return null;
      const handles = [
        { name: 'first', x: geometry.xForProgress(curve.x1), y: geometry.yForValue(curve.y1) },
        { name: 'second', x: geometry.xForProgress(curve.x2), y: geometry.yForValue(curve.y2) }
      ];
      return handles.find((handle) => Math.hypot(pointer.x - handle.x, pointer.y - handle.y) < 12) || null;
    }

    function editHandle(event) {
      if (!state.draggingHandle) return;
      const geometry = getGraphGeometry();
      const pointer = pointerPosition(event);
      if (state.graph.type === 'elastic') {
        const elastic = state.graph.elastic;
        const drag = state.dragStart;
        if (state.draggingHandle === 'elastic-period') {
          elastic.period = window.MotionGraphEngine.clamp(
            drag.period + (pointer.x - drag.pointer.x) / drag.geometry.graphWidth,
            0.04,
            1
          );
        } else if (state.draggingHandle === 'elastic-amplitude') {
          elastic.amplitude = window.MotionGraphEngine.clamp(
            drag.amplitude - (pointer.y - drag.pointer.y) * 0.25,
            0,
            3
          );
        }
        syncParameterInputs();
        stateStatus.textContent = 'EDITING ELASTIC / APPLY WHEN READY';
        refreshGraph();
        return;
      }
      if (state.graph.type === 'step') {
        const step = state.graph.step;
        if (state.draggingHandle === 'step-count') {
          step.steps = Math.round(window.MotionGraphEngine.clamp(geometry.progressForX(pointer.x) * 32, 1, 32));
          syncParameterInputs();
          stateStatus.textContent = 'EDITING STEP / APPLY WHEN READY';
          refreshGraph();
        }
        return;
      }
      if (state.graph.type === 'bouncing') {
        const bounce = state.graph.bouncing;
        if (state.draggingHandle === 'bounce-count') {
          bounce.bounces = Math.round(window.MotionGraphEngine.clamp(geometry.progressForX(pointer.x) * 12, 1, 12));
        } else if (state.draggingHandle === 'bounce-strength') {
          bounce.strength = window.MotionGraphEngine.clamp(Math.abs(geometry.rawValueForY(pointer.y) - 1), 0, 1);
        }
        syncParameterInputs();
        stateStatus.textContent = 'EDITING BOUNCING / APPLY WHEN READY';
        refreshGraph();
        return;
      }
      const curve = getEditableCurve();
      if (!curve) return;
      const key = state.draggingHandle === 'first' ? 'x1' : 'x2';
      const valueKey = state.draggingHandle === 'first' ? 'y1' : 'y2';
      curve[key] = geometry.progressForX(pointer.x);
      curve[valueKey] = window.MotionGraphEngine.clamp(geometry.rawValueForY(pointer.y), -2, 3);
      syncParameterInputs();
      stateStatus.textContent = `EDITING ${state.graph.type.toUpperCase()} / APPLY WHEN READY`;
      refreshGraph();
    }

    function refreshGraph() {
      drawGraph();
    }

    graphModeToggle.addEventListener('click', () => {
      state.mode = state.mode === 'value' ? 'speed' : 'value';
      const speedActive = state.mode === 'speed';
      graphModeToggle.textContent = state.mode.toUpperCase();
      graphModeToggle.setAttribute('aria-pressed', String(speedActive));
      // SPEED is a preview of the curve's rate of change - there's no
      // (correct, yet) way to turn that into applied keyframes, so the panel
      // disables Apply here instead of round-tripping to the host just to
      // get told no.
      applyButton.disabled = speedActive;
      applyButton.title = speedActive ? 'Switch to VALUE mode before applying.' : '';
      contextStatus.textContent = `${state.mode.toUpperCase()} GRAPH / ${state.graph.type.toUpperCase()}`;
      if (speedActive) {
        stateStatus.textContent = 'SPEED MODE IS PREVIEW-ONLY / SWITCH TO VALUE TO APPLY';
      }
      refreshGraph();
    });

    expressionToggle.addEventListener('click', () => {
      state.expressionMode = state.expressionMode === 'keyframe' ? 'expression' : 'keyframe';
      const expressionActive = state.expressionMode === 'expression';
      expressionToggle.textContent = state.expressionMode.toUpperCase();
      expressionToggle.setAttribute('aria-pressed', String(expressionActive));
      stateStatus.textContent = `${state.expressionMode.toUpperCase()} MODE / APPLICATION BRIDGE STANDBY`;
    });

    graphTypeSelect.addEventListener('change', () => {
      state.graphType = graphTypeSelect.value;
      state.graph = window.MotionGraphEngine.createDefinition(state.graphType);
      syncCurveMode();
      renderParameters();
      contextStatus.textContent = `${state.mode.toUpperCase()} GRAPH / ${state.graph.type.toUpperCase()}`;
      refreshGraph();
    });

    resetButton.addEventListener('click', () => {
      state.graph = window.MotionGraphEngine.createDefinition(state.graphType);
      syncCurveMode();
      renderParameters();
      stateStatus.textContent = `RESET ${state.graph.type.toUpperCase()} / APPLY WHEN READY`;
      refreshGraph();
    });

    canvas.addEventListener('pointerdown', (event) => {
      const handle = findHandle(event);
      if (!handle) return;
      const geometry = getGraphGeometry();
      const pointer = pointerPosition(event);
      state.dragStart = {
        pointer,
        geometry,
        period: state.graph.type === 'elastic' ? state.graph.elastic.period : null,
        amplitude: state.graph.type === 'elastic' ? state.graph.elastic.amplitude : null
      };
      state.draggingHandle = handle.name;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('is-editing');
      event.preventDefault();
    });

    canvas.addEventListener('pointermove', editHandle);
    canvas.addEventListener('pointerup', (event) => {
      if (!state.draggingHandle) return;
      state.draggingHandle = null;
      state.dragStart = null;
      canvas.releasePointerCapture(event.pointerId);
      canvas.classList.remove('is-editing');
    });
    canvas.addEventListener('pointercancel', () => {
      state.draggingHandle = null;
      state.dragStart = null;
      canvas.classList.remove('is-editing');
    });

    applyButton.addEventListener('click', () => {
      const payload = window.MotionGraphEngine.createApplyPayload(state);
      if (window.MotionGraphApplication) window.MotionGraphApplication.apply(payload);
      stateStatus.textContent = 'APPLY REQUEST READY / PHASE 2 BRIDGE';
    });

    window.addEventListener('motion-graph-apply-result', (event) => {
      const result = event.detail || {};
      stateStatus.textContent = result.ok
        ? `APPLIED / ${result.message}`
        : `ERROR / ${result.message || 'Could not apply graph.'}`;
      stateStatus.classList.toggle('graph-state-error', !result.ok);
    });

    window.addEventListener('motion-graph-context', (event) => {
      window.MotionGraphEditor.setContext(event.detail || {});
      const detail = event.detail || {};
      if (detail.keyframeCount) {
        const summary = editor.querySelector('[data-keyframe-summary]');
        summary.textContent = (detail.selectedKeyCount >= 2)
          ? `${detail.selectedKeyCount} OF ${detail.keyframeCount} SELECTED`
          : `${detail.keyframeCount} KEYFRAMES`;
        state.keyframeCount = detail.keyframeCount;
      }
    });

    window.addEventListener('resize', resizeCanvas);

    window.MotionGraphEditor = {
      setContext(nextContext) {
        contextStatus.textContent = nextContext.status || 'READY';
        stateStatus.textContent = nextContext.detail || 'UI READY / APPLICATION BRIDGE STANDBY';
        const emptyState = editor.querySelector('[data-graph-empty]');
        emptyState.hidden = true;
        editor.classList.toggle('graph-context-empty', Boolean(nextContext.empty));
      }
    };

    resizeCanvas();
    syncCurveMode();
    renderParameters();
    refreshGraph();
  });
})();
