(() => {
  const TAU = Math.PI * 2;

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function cubicBezierCoordinate(t, first, second) {
    const inverse = 1 - t;
    return 3 * inverse * inverse * t * first + 3 * inverse * t * t * second + t * t * t;
  }

  function solveBezierTime(progress, definition) {
    let low = 0;
    let high = 1;
    let guess = progress;

    for (let iteration = 0; iteration < 12; iteration += 1) {
      const x = cubicBezierCoordinate(guess, definition.x1, definition.x2);
      if (Math.abs(x - progress) < 0.00001) return guess;
      if (x < progress) low = guess;
      else high = guess;
      guess = (low + high) / 2;
    }
    return guess;
  }

  function evaluateDefinition(definition, progress) {
    const type = definition.type;
    const t = clamp(progress, 0, 1);

    if (type === 'bezier' || type === 'custom') {
      const bezier = type === 'custom' ? definition.custom : definition.bezier;
      const solvedTime = solveBezierTime(t, bezier);
      return cubicBezierCoordinate(solvedTime, bezier.y1, bezier.y2);
    }

    if (type === 'elastic') {
      if (t === 0 || t === 1) return t;
      const amplitude = definition.elastic.amplitude;
      const period = definition.elastic.period;
      const damping = definition.elastic.damping;
      return t + amplitude * Math.sin(t / period * TAU)
        * 2 * Math.exp(-damping * t) * (1 - t);
    }

    if (type === 'bouncing') {
      const bounce = definition.bouncing;
      if (t === 0 || t === 1) return t;
      const bounces = Math.max(1, Math.round(bounce.bounces || 1));
      const segments = bounces + 1;
      const segment = Math.min(Math.floor(t * segments), segments - 1);
      if (segment === 0) {
        const localTime = t * segments;
        return localTime * localTime;
      }
      const segmentMid = (segment + 0.5) / segments;
      const halfWidth = 0.5 / segments;
      const normalized = (t - segmentMid) / halfWidth;
      return 1 - Math.pow(bounce.strength, segment) * (1 - normalized * normalized);
    }

    if (type === 'step') {
      const step = t * definition.step.steps;
      const hold = definition.step.hold || 'floor';
      const quantized = hold === 'ceil' ? Math.ceil(step) : hold === 'round' ? Math.round(step) : Math.floor(step);
      return clamp(quantized / definition.step.steps, 0, 1);
    }

    return t;
  }

  function evaluate(typeOrDefinition, progress) {
    const definition = typeof typeOrDefinition === 'string'
      ? createDefinition(typeOrDefinition)
      : typeOrDefinition;
    return evaluateDefinition(definition, progress);
  }

  function speed(definition, progress) {
    const epsilon = 0.0005;
    return (evaluateDefinition(definition, clamp(progress + epsilon, 0, 1))
      - evaluateDefinition(definition, clamp(progress - epsilon, 0, 1))) / (2 * epsilon);
  }

  function sample(definition, mode, count) {
    const points = [];
    const sampleCount = count || 96;

    for (let index = 0; index <= sampleCount; index += 1) {
      const progress = index / sampleCount;
      const value = mode === 'speed' ? speed(definition, progress) : evaluateDefinition(definition, progress);
      points.push({ progress, value });
    }

    return points;
  }

  function evaluateKeyframes(keyframes, time, definition) {
    if (!keyframes || keyframes.length < 2) return null;
    let intervalIndex = 0;

    for (let index = 0; index < keyframes.length - 1; index += 1) {
      if (time <= keyframes[index + 1].time) {
        intervalIndex = index;
        break;
      }
      intervalIndex = index;
    }

    const start = keyframes[intervalIndex];
    const end = keyframes[Math.min(intervalIndex + 1, keyframes.length - 1)];
    const duration = end.time - start.time;
    const localTime = duration === 0 ? 0 : clamp((time - start.time) / duration, 0, 1);
    const interpolation = evaluateDefinition(definition, localTime);
    if (Array.isArray(start.value)) {
      return start.value.map((value, component) => value + (end.value[component] - value) * interpolation);
    }
    return start.value + (end.value - start.value) * interpolation;
  }

  function createDefinition(type) {
    return {
      type,
      bezier: { x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.9 },
      elastic: { amplitude: 1, period: 0.25, damping: 2.4 },
      bouncing: { strength: 0.6, decay: 1.4, bounces: 2 },
      step: { steps: 4, hold: 'floor' },
      custom: { x1: 0.04, y1: 0.04, x2: 0.96, y2: 1.18 }
    };
  }

  function createApplyPayload(state) {
    return {
      mode: state.mode,
      graph: state.graph,
      expressionMode: state.expressionMode,
      keyframeCount: state.keyframeCount,
      source: 'motion-graph-editor'
    };
  }

  window.MotionGraphEngine = {
    clamp,
    evaluate,
    createDefinition,
    sample,
    speed,
    evaluateKeyframes,
    createApplyPayload
  };
})();
