MCG.GeometrySet = (function() {

  function GeometrySet(attributes) {
    this.attributes = attributes;

    this.axis = attributes.axis;
    this.ah = attributes.ah;
    this.av = attributes.av;
    this.up = attributes.up;

    this.precision = attributes.precision;
    this.epsilon = attributes;

    this.count = 0;

    this.type = MCG.GeometryTypes.abstractSet;
  }

  return GeometrySet;

})();


MCG.PolygonSet = (function() {

  function PolygonSet(attributes) {
    MCG.GeometrySet.call(this, attributes);

    this.type = MCG.GeometryTypes.polygonSet;
    this.polygons = [];
  }

  PolygonSet.prototype.add = function(p) {
    this.polygons.push(p);
    this.count++;
  }

  return PolygonSet;

})();


MCG.SegmentSet = (function() {

  function SegmentSet(attributes) {
    MCG.GeometrySet.call(this, attributes);

    this.type = MCG.GeometryTypes.segmentSet;
    this.segments = [];
  }

  SegmentSet.prototype.add = function(v1, v2, normal) {
    var attributes = this.attributes;

    var p1 = new MCG.Point(v1, attributes);
    var p2 = new MCG.Point(v2, attributes);

    if (MCG.Math.coincident(p1, p2)) return;

    // determine which way the winding order points
    var cross = this.up.clone().cross(normal);
    var dot = cross.dot(v2.clone().sub(v1));

    // make segment s.t. polygon is on the left when traversing from v1 to v2
    var segment = dot > 0 ? new MCG.Segment(p1, p2) : new MCG.Segment(p2, p1);

    this.segments.push(segment);
    this.count++;
  }

  SegmentSet.prototype.toPolygonSet = function() {
    var attributes = this.attributes;

    var pset = new MCG.PolygonSet(attributes);

    var p = Math.pow(10, this.precision);
    var adjacencyMap = new MCG.DirectedAdjacencyMap(attributes);

    var segments = this.segments;
    var ns = segments.length;

    for (var si = 0; si < ns; si++) adjacencyMap.addSegment(segments[si]);

    var loops = adjacencyMap.getLoops();
    for (var li = 0; li < loops.length; li++) {
      pset.add(new MCG.Polygon(loops[li], attributes));
    }

    debug.cleanup();
    var o = 0;
    for (var i=0; i<pset.polygons.length; i++) {
      o += 1;
      var poly = pset.polygons[i];
      console.log(poly);
      //poly.checkCollinear();
      var np = poly.points.length;
      for (var j=0; j<np; j++) {
        debug.line(poly.points[j].src, poly.points[(j+1+np)%np].src, 1, false, o, attributes.axis);
      }
    }
    debug.lines();

    return pset;
  }

  return SegmentSet;

})();
