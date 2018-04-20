MCG.Polygon = (function() {

  function Polygon(sourcePoints, context) {
    this.context = context;

    this.axis = context.axis;
    this.ah = context.ah;
    this.av = context.av;
    this.up = context.up;

    this.precision = context.precision;
    this.epsilon = context;

    this.count = 0;
    this.area = 0;
    this.hole = false;

    // no vertices or an insufficient number of vertices
    if (!sourcePoints || sourcePoints.length < 3) {
      return;
    }

    // build the points array, eliminating collinear vertices

    this.points = [];
    var points = this.points;

    var collinear = MCG.Math.collinear;

    var ns = sourcePoints.length;
    for (var si = 0; si < ns; si++) {
      var spt = sourcePoints[si];
      var ct = this.count;

      // if last three points are collinear, replace last point with new point
      if (ct > 1 && collinear(points[ct-2], points[ct-1], spt)) {
        points[ct-1] = spt;
      }
      // else, just add the new point
      else {
        points.push(spt);
        this.count++;
      }
    }

    // eliminate points 0 and/or 1 if they are collinear with their neighbors
    var ct = this.count;
    if (collinear(points[ct-2], points[ct-1], points[0])) points.splice(--ct, 1);
    if (collinear(points[ct-1], points[0], points[1])) points.splice(0, 1);

    this.count = points.length;

    // if entire polygon is collinear, it's invalid
    if (this.count < 3) {
      return;
    }

    var area = MCG.Math.area;

    // calculate area
    for (var i = 2; i < this.count; i++) {
      if (ct > 1) {
        this.area += area(points[0], points[i-1], points[i], context);
      }
    }

    this.hole = this.area < 0;
  }

  Object.assign(Polygon.prototype, {

    forEach: function(f) {
      var points = this.points;
      var ct = this.count;

      for (var i = 0; i < ct; i++) {
        f(points[i]);
      }
    },

    forEachPointPair: function(f) {
      var points = this.points;
      var ct = this.count;

      for (var i = 0; i < ct; i++) {
        var p1 = points[i];
        var p2 = points[(i+1+ct)%ct];

        f(p1, p2);
      }
    },

    valid: function() {
      return this.count >= 3;
    }

  });

  return Polygon;

})();
