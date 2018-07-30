Object.assign(MCG.Infill, (function() {

  var Types = {
    none: 0,
    linear: 1,
    grid: 2,
    triangle: 4,
    hex: 8
  };

  function generate(contour, type, params) {
    params = params || {};

    if (type === Types.linear) {
      return generateLinear(contour, params.angle, params.spacing, params.parity);
    }
    if (type === Types.grid) {
      return generateGrid(contour, params.angle, params.spacing);
    }
    if (type === Types.triangle) {
      return generateTriangle(contour, params.spacing);
    }
    if (type === Types.hex) {
      return generateHex(contour, params.spacing, params.linewidth, params.parity);
    }

    return null;
  }

  function generateLinear(contour, angle, spacing, parity) {
    context = contour.context;
    angle = angle || 0;
    spacing = spacing || context.p;
    parity = parity || 0;

    // constants
    var pi = Math.PI;
    var pi2 = pi * 2;
    var pi_2 = pi / 2;

    // rotate by 90 degrees if nonzero parity
    if (parity !== 0) angle += pi_2;

    var contourRotated = contour.clone(true).rotate(angle);

    var op = MCG.Sweep.Operations.linearInfill({
      spacing: spacing
    });

    var infillRotated = MCG.Sweep.sweep(op, contourRotated).infill;

    return infillRotated.rotate(-angle);
  }

  function generateGrid(contour, angle, spacing) {
    context = contour.context;
    angle = angle || 0;
    spacing = spacing || context.p;

    // constants
    var pi = Math.PI;
    var pi2 = pi * 2;
    var pi_2 = pi / 2;

    var contourRotated = contour.clone(true).rotate(angle);

    var op0 = MCG.Sweep.Operations.linearInfill({
      spacing: spacing
    });
    var infillRotated0 = MCG.Sweep.sweep(op0, contourRotated).infill;

    contourRotated.rotate(pi_2);
    var op1 = MCG.Sweep.Operations.linearInfill({
      spacing: spacing
    });
    var infillRotated1 = MCG.Sweep.sweep(op1, contourRotated).infill;

    infillRotated1.rotate(-pi_2).merge(infillRotated0);

    return infillRotated1.rotate(-angle);
  }

  return {
    Types: Types,
    generate: generate
  }

})());
