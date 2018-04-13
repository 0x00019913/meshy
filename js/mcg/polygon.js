MCG.Polygon = (function() {

  function Polygon(sourcePoints, attributes) {
    this.attributes = attributes;

    this.axis = attributes.axis;
    this.ah = attributes.ah;
    this.av = attributes.av;
    this.up = attributes.up;

    this.precision = attributes.precision;
    this.epsilon = attributes;

    this.valid = true;

    this.count = 0;
    this.area = 0;
    this.hole = false;

    // no vertices or an insufficient number of vertices
    if (!sourcePoints || sourcePoints.length < 3) {
      this.valid = false;
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
      this.valid = false;
      return;
    }

    var area = MCG.Math.area;

    // calculate area
    for (var i = 2; i < this.count; i++) {
      if (ct > 1) {
        this.area += area(points[0], points[i-1], points[i]);
      }
    }

    this.hole = this.area < 0;
  }

  return Polygon;

})();
