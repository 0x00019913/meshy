/*
  Integer point based on a Vector3, expanded to p decimal places.
*/

MCG.Point = (function() {

  function Point(v, attributes) {
    var p = attributes.p;

    this.src = v;
    this.sh = v[attributes.ah];
    this.sv = v[attributes.av];
    this.h = numHash(this.sh, p);
    this.v = numHash(this.sv, p);

    this.type = MCG.GeometryTypes.point;
  }

  Point.prototype.hash = function() {
    return this.h + "_" + this.v;
  }

  Point.prototype.vectorTo = function(pt) {
    return pt.src.clone().sub(this.src);
  }

  return Point;

})();
