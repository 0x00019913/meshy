MCG.GeometrySet = (function() {

  function GeometrySet(context) {
    this.context = context;

    this.axis = context.axis;
    this.ah = context.ah;
    this.av = context.av;
    this.up = context.up;

    this.precision = context.precision;
    this.epsilon = context;

    this.elements = [];

    this.type = MCG.Types.abstractSet;
  }

  Object.assign(GeometrySet.prototype, {

    forEach: function(f) {
      var elements = this.elements;
      var ct = this.elements.length;

      for (var i = 0; i < ct; i++) {
        f(elements[i]);
      }
    },

    add: function(e) {
      if (e.valid()) this.elements.push(e);
    },

    count: function() {
      return this.elements.length;
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

    forEachPointPair: function(f) {
      var polygons = this.elements;
      var ct = this.count();

      for (var i = 0; i < ct; i++) {
        polygons[i].forEachPointPair(f);
      }
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

      var p = Math.pow(10, this.precision);
      var adjacencyMap = new MCG.DirectedAdjacencyMap(context);

      var segments = this.elements;
      var ns = segments.length;

      for (var si = 0; si < ns; si++) {
        adjacencyMap.addSegment(segments[si]);
      }

      var loops = adjacencyMap.getLoops();
      for (var li = 0; li < loops.length; li++) {
        pset.add(new MCG.Polygon(loops[li], context));
      }

      return pset;
    }

  });

  return SegmentSet;

})();
