MCG.PolygonSet = (function() {

  function PolygonSet(context) {
    MCG.GeometrySet.call(this, context);

    this.type = MCG.Types.polygonSet;
  }

  PolygonSet.prototype = Object.create(MCG.GeometrySet.prototype)

  Object.assign(PolygonSet.prototype, {

    constructor: PolygonSet,

    forEachPoint: function(f) {
      this.forEach(function(polygon) {
        polygon.forEach(f);
      });
    },

    forEachPointPair: function(f) {
      this.forEach(function(polygon) {
        polygon.forEachPointPair(f);
      });
    },

    forEachSegmentPair: function(f) {
      this.forEach(function(polygon) {
        polygon.forEachSegmentPair(f);
      });
    },

    computeBisectors: function() {
      this.forEach(function(polygon) {
        polygon.computeBisectors();
      });
    },

    offset: function(dist) {
      var polygonSet = new this.constructor(this.context);

      this.forEach(function(polygon) {
        polygonSet.add(polygon.offset(dist));
      });

      return polygonSet;
    },

    decimate: function(tol) {
      this.forEach(function(polygon) {
        polygon.decimate(tol);
      });

      return this;
    }

  });

  return PolygonSet;

})();
