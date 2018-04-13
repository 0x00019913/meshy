MCG.Attributes = (function() {

  function Attributes(axis, precision) {
    if (axis === undefined) axis = 'z';
    if (precision === undefined) precision = 5;

    this.axis = axis;
    this.ah = cycleAxis(axis);
    this.av = cycleAxis(this.ah);
    this.up = makeAxisUnitVector(axis);
    this.precision = precision;

    this.epsilon = Math.pow(10, -this.precision);
    this.p = Math.pow(10, this.precision);
  }

  return Attributes;

})();
