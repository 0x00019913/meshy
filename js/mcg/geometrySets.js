MCG.GeometrySet = (function() {

  function GeometrySet(context) {
    this.context = context;

    this.elements = [];

    this.type = MCG.Types.abstractSet;
  }

  Object.assign(GeometrySet.prototype, {

    add: function(e) {
      if (e.valid()) this.elements.push(e);
    },

    count: function() {
      return this.elements.length;
    },

    forEach: function(f) {
      var elements = this.elements;
      var ct = this.elements.length;

      for (var i = 0; i < ct; i++) {
        f(elements[i]);
      }
    }

  });

  return GeometrySet;

})();


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
    }

  });

  return PolygonSet;

})();


MCG.SegmentSet = (function() {

  function SegmentSet(context) {
    MCG.GeometrySet.call(this, context);

    this.type = MCG.Types.segmentSet;
  }

  SegmentSet.prototype = Object.create(MCG.GeometrySet.prototype);

  Object.assign(SegmentSet.prototype, {

    constructor: SegmentSet,

    addPointPair: function(p1, p2) {
      this.add(new MCG.Segment(this.context, p1, p2));
    },

    forEachPointPair: function(f) {
      var segments = this.elements;
      var ct = this.count();

      for (var i = 0; i < ct; i++) {
        var s = segments[i];
        f(s.p1, s.p2);
      }
    },

    toPolygonSet: function() {
      var context = this.context;

      var pset = new MCG.PolygonSet(context);

      var p = this.context.p;
      var adjacencyMap = new MCG.DirectedAdjacencyMap(context);

      var segments = this.elements;
      var ns = segments.length;

      for (var si = 0; si < ns; si++) {
        adjacencyMap.addSegment(segments[si]);
      }

      var loops = adjacencyMap.getLoops();
      for (var li = 0; li < loops.length; li++) {
        var polygon = new MCG.Polygon(context, loops[li]);
        if (polygon.valid()) pset.add(polygon);
      }

      return pset;
    }

  });

  return SegmentSet;

})();
