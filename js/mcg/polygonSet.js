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
        if (polygon.valid()) polygon.forEach(f);
      });
    },

    forEachPointPair: function(f) {
      this.forEach(function(polygon) {
        if (polygon.valid()) polygon.forEachPointPair(f);
      });
    },

    forEachSegmentPair: function(f) {
      this.forEach(function(polygon) {
        if (polygon.valid()) polygon.forEachSegmentPair(f);
      });
    },

    computeBisectors: function() {
      this.forEach(function(polygon) {
        if (polygon.valid()) polygon.computeBisectors();
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

      // remove invalid polygons
      this.filter(function(polygon) {
        return polygon.valid();
      });

      return this;
    },

    pointCount: function() {
      var count = 0;

      this.forEach(function(polygon) {
        count += polygon.count();
      });

      return count;
    }

  });

  return PolygonSet;

})();
