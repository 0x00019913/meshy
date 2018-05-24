MCG.Polygon = (function() {

  function Polygon(context, sourcePoints, open) {
    this.context = context;

    // closed by default
    this.closed = !open;

    this.points = [];
    this.bisectors = null;
    this.angles = null;

    this.area = 0;

    this.max = new MCG.Vector(context).setScalar(-Infinity);
    this.min = new MCG.Vector(context).setScalar(Infinity);

    // construct the polygon

    if (!sourcePoints) return this;
    if (this.closed && sourcePoints.length < 3) return this;

    // build the points array, eliminating collinear vertices
    var points = this.points;
    var collinear = MCG.Math.collinear;

    var ns = sourcePoints.length;
    for (var si = 0; si < ns; si++) {
      var spt = sourcePoints[si];
      var ct = points.length;

      // if last three points are collinear, replace last point with new point
      if (ct > 1 && collinear(points[ct-2], points[ct-1], spt)) {
        points[ct-1] = spt;
      }
      // else, just add the new point
      else {
        points.push(spt);
        this.updateBounds(spt);
      }
    }

    if (!this.valid()) return this;

    if (this.closed) {
      // eliminate points 0 and/or 1 if they are collinear with their neighbors
      var ct = this.count();
      if (collinear(points[ct-2], points[ct-1], points[0])) points.splice(--ct, 1);
      if (collinear(points[ct-1], points[0], points[1])) points.splice(0, 1);

      this.calculateArea();
    }

    return this;
  }

  Object.assign(Polygon.prototype, {

    count: function() {
      return this.points.length;
    },

    // for each point
    forEach: function(f) {
      var points = this.points;
      var ct = points.length;
      var bisectors = this.bisectors;

      for (var i = 0; i < ct; i++) {
        var b = bisectors !== null ? bisectors[i] : undefined;

        f(points[i], b);
      }
    },

    // for each sequence of two points
    forEachPointPair: function(f) {
      var points = this.points;
      var ct = points.length;
      var ct1 = ct - 1;

      for (var i = 0; i < ct; i++) {
        var p1 = points[i];
        var p2 = points[(i < ct1) ? i+1 : (i+1+ct)%ct];

        f(p1, p2);
      }
    },

    // for each sequence of three points
    forEachSegmentPair: function(f) {
      var points = this.points;
      var ct = points.length;
      var ct1 = ct - 1;
      var ct2 = ct - 2;

      for (var i = 0; i < ct; i++) {
        var p1 = points[i];
        var p2 = points[(i < ct1) ? i+1 : (i+1+ct)%ct];
        var p3 = points[(i < ct2) ? i+2 : (i+2+ct)%ct];

        f(p1, p2, p3);
      }
    },

    updateBounds: function(pt) {
      this.max.max(pt);
      this.min.min(pt);
    },

    size: function() {
      return this.min.vectorTo(this.max);
    },

    calculateArea: function() {
      this.area = 0;

      var area = MCG.Math.area;
      var points = this.points;
      var ct = this.count();

      for (var i = 1; i < ct - 1; i++) {
        this.area += area(points[0], points[i], points[i+1]);
      }
    },

    valid: function() {
      if (this.closed) return this.count() >= 3;
      else return this.count() > 1;
    },

    invalidate: function() {
      this.points = [];

      return this;
    },

    createNew: function() {
      return new this.constructor(this.context, undefined, this.open);
    },

    clone: function() {
      var clone = this.createNew();

      Object.assign(clone, this);

      // make a new array b/c for clone's cloned points
      clone.points = [];

      // clone the points
      var ct = this.count();
      for (var i = 0; i < ct; i++) {
        clone.points[i] = this.points[i].clone();
      }

      return clone;
    },

    fromPoints: function(points) {
      this.points = points;

      this.calculateArea();

      return this;
    },

    // compute bisectors and angles between each edge pair and its bisector
    computeBisectors: function() {
      // return if bisectors already calculated or if polygon is open
      if (this.bisectors !== null || !this.closed) return;

      this.bisectors = [];
      this.angles = [];

      var bisectors = this.bisectors;
      var angles = this.angles;
      var points = this.points;

      var ct = this.count();

      for (var i = 0; i < ct; i++) {
        var p1 = points[(i-1+ct)%ct];
        var p2 = points[i];
        var p3 = points[(i+1+ct)%ct];

        var b = MCG.Math.bisector(p1, p2, p3);

        bisectors.push(b);
        angles.push(p2.vectorTo(p3).angleTo(b));
      }
    },

    // offset everything in the polygon set by a given distance (given in
    // floating-point-space units)
    offset: function(dist) {
      var clone = this.clone();

      var size = this.size();
      var minsize = Math.min(size.h, size.v) / this.context.p;

      if (dist <= -minsize / 2) {
        clone.invalidate();
        return clone;
      }

      this.computeBisectors();

      var bisectors = this.bisectors;
      var angles = this.angles;
      var points = this.points;
      var cpoints = clone.points;
      var ct = this.count();

      for (var i = 0; i < ct; i++) {
        // shift along bisector s.t. every segment in the clone will be the same
        // distance (dist) from its original
        var b = bisectors[i];
        var d = dist / Math.sin(angles[i]);

        cpoints[i].addScaledVector(b, d);
      }

      return clone;
    },

    decimate: function(tol) {
      var points = this.points;
      var ct = this.count();
      var tol2 = tol * tol;

      var resultPoints = [];

      var ref = points[0];

      for (var si = 0; si < ct; si++) {
        var spt = points[si];

        // if distance is >= tolerance, include the point and set it as
        // reference point
        if (ref.distanceToSq(spt) >= tol2) {
          resultPoints.push(spt);
          ref = spt;
        }
      }

      return this.fromPoints(resultPoints);
    }

  });

  return Polygon;

})();
