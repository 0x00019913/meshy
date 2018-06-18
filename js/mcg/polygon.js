MCG.Polygon = (function() {

  function Polygon(context, sourcePoints, params) {
    this.context = context;

    // closed by default
    this.closed = !(params && params.open);

    this.points = [];
    this.bisectors = null;
    this.angles = null;

    this.area = 0;

    this.min = null;
    this.max = null;

    this.initBounds();

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

    if (!this.valid()) return this;

    this.calculateBounds();

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

    initBounds: function() {
      var context = this.context;

      this.min = new MCG.Vector(context).setScalar(Infinity);
      this.max = new MCG.Vector(context).setScalar(-Infinity);
    },

    initArea: function() {
      this.area = 0;
    },

    updateBounds: function(pt) {
      this.min.min(pt);
      this.max.max(pt);
    },

    updateBoundsFromThis: function(min, max) {
      min.min(this.min);
      max.max(this.max);
    },

    calculateBounds: function() {
      var context = this.context;

      this.initBounds();

      var _this = this;

      this.forEach(function(p) {
        _this.updateBounds(p);
      });
    },

    calculateArea: function() {
      this.area = 0;

      if (!this.closed) return;

      var area = MCG.Math.area;
      var points = this.points;
      var ct = this.count();

      for (var i = 1; i < ct - 1; i++) {
        this.area += area(points[0], points[i], points[i+1]);
      }
    },

    perimeter: function() {
      var result = 0;

      this.forEachPointPair(function(p1, p2) {
        result += p1.distanceTo(p2);
      });

      return result;
    },

    isSliver: function(tol) {
      tol = tol || this.context.p / 25;

      return this.area / this.perimeter() < tol;
    },

    size: function() {
      return this.min.vectorTo(this.max);
    },

    valid: function() {
      if (this.closed) return this.count() >= 3;
      else return this.count() > 1;
    },

    invalidate: function() {
      this.points = [];
      this.initArea();
      this.initBounds();

      return this;
    },

    createNew: function() {
      return new this.constructor(this.context, undefined, this.closed);
    },

    clone: function(recursive) {
      var clone = this.createNew();

      Object.assign(clone, this);

      if (recursive) {
        // make a new array
        clone.points = [];

        // clone the points
        var ct = this.count();
        for (var i = 0; i < ct; i++) {
          clone.points[i] = this.points[i].clone();
        }
      }

      return clone;
    },

    fromPoints: function(points) {
      this.points = points;

      this.calculateArea();
      this.calculateBounds();

      return this;
    },

    rotate: function(angle) {
      this.forEach(function(point) {
        point.rotate(angle);
      });

      this.calculateBounds();

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

    // offset, but the arguments are given in floating-point space
    foffset: function(fdist, ftol) {
      var context = this.context;
      var dist = MCG.Math.ftoi(fdist, context);
      var tol = ftol !== undefined ? MCG.Math.ftoi(ftol, context): 0;

      return this.offset(dist, tol);
    },

    // offset every point in the polygon by a given distance (positive for
    // outward, negative for inward, given in integer-space units)
    offset: function(dist, tol) {
      var result = this.createNew();

      if (!this.valid()) return result;

      var size = this.size();
      var minsize = Math.min(size.h, size.v);
      var fdist = MCG.Math.itof(dist, this.context);
      var tol = tol || 0;

      if (dist <= -minsize / 2) return result;

      this.computeBisectors();

      var bisectors = this.bisectors;
      var angles = this.angles;
      var points = this.points;
      var rpoints = [];
      var ct = this.count();

      var pi = Math.PI;
      var pi2 = pi / 2;
      var orthogonalRightVector = MCG.Math.orthogonalRightVector;
      var coincident = MCG.Math.coincident;

      // 30-degree lower threshold and 150-degree upper threshold for capping
      // the offset off a spike or ignoring the offset inside a cusp
      var tcaplow = pi / 6;
      var tcaphigh = pi - tcaplow;

      for (var i = 0; i < ct; i++) {
        var b = bisectors[i];
        var pti = points[i];
        // angle between the offset vector and the neighboring segments (because
        // the angles array stores the angle relative to the outward-facing
        // bisector, which may be antiparallel to the offset vector)
        var a = fdist > 0 ? angles[i] : (pi - angles[i]);
        var d = fdist / Math.sin(a);
        var displacement = pti.clone().addScaledVector(b, d);

        // if shifting out from a point, cap the resulting spike with a
        // segment whose center is fdist away from the current point
        if (a > tcaphigh) {
          // half-angle between displacement and vector orthogonal to segment
          var ha = (a - pi2) / 2;

          // half-length of the cap for the spike
          var hl = fdist * Math.tan(ha);

          // orthogonal vector from the end of the displacement vector
          var ov = orthogonalRightVector(pti.vectorTo(displacement));

          // midpoint of the cap
          var mc = pti.clone().addScaledVector(b, fdist);

          // endpoints of the cap segment
          var p0 = mc.clone().addScaledVector(ov, -hl);
          var p1 = mc.clone().addScaledVector(ov, hl);

          if (coincident(p0, p1)) addPoints(displacement);
          else {
            var fpt = fdist > 0 ? p0 : p1;
            var spt = fdist > 0 ? p1 : p0;

            addPoints(fpt, spt);
          }
        }
        // if shift is "inside a cusp", just shift along bisector s.t. the
        // resulting segments will be displaced by fdist, but only if the cusp
        // is wide enough
        else if (a > tcaplow) {
          addPoints(displacement);
        }
        // else, cusp is too narrow, so just don't offset
      }

      result.fromPoints(rpoints);

      //console.log(result.area, tol*tol);

      // if result area is too small, invalidate it
      if (Math.abs(result.area) < tol * tol) result.invalidate();

      return result;

      function addPoints() {
        var rlen = rpoints.length;
        var arglen = arguments.length;
        var prevpt = null;

        if (rlen > 0) prevpt = rpoints[rlen-1];

        for (var ai = 0; ai < arglen; ai++) {
          var apt = arguments[ai];

          if (!prevpt || (prevpt.distanceToSq(apt) > tol)) {
            rpoints.push(apt);
            prevpt = apt;
          }

        }
      }
    },

    fdecimate: function(ftol) {
      var tol = MCG.Math.ftoi(ftol, this.context);

      return this.decimate(tol);
    },

    // reduce vertex count
    // source: http://geomalgorithms.com/a16-_decimate-1.html
    // NB: this mutates the polygon
    decimate: function(tol) {
      if (tol <= 0) return this;

      // source points
      var spts = this.points;

      // first, decimate by vertex reduction
      var vrpts = decimateVR(spts, tol);

      this.fromPoints(vrpts);

      if (Math.abs(this.area) < tol * tol) this.invalidate();

      return this;

      function decimateVR(pts, tol) {
        var ct = pts.length;
        var tolsq = tol * tol;

        // index of the reference point
        var refidx = 0;

        // result points
        var rpts = [];
        rpts.push(pts[0]);

        for (var si = 1; si < ct; si++) {
          var spt = pts[si];

          // if distance is < tolerance, ignore the point
          if (pts[refidx].distanceToSq(spt) < tolsq) continue;

          // else, include it and set it as the new reference point
          rpts.push(spt);
          refidx = si;
        }

        return rpts;
      }

      function decimateCollinear(pts, tol) {
        var ct = pts.length;
        var ct1 = ct - 1;
        var tolsq = tol * tol;

        // result points
        var rpoints = [];

        var narea = MCG.Math.narea;

        for (var si = 0; si < ct; si++) {
          var pt0 = si === 0 ? pts[ct1] : pts[si-1];
          var pt1 = pts[si];
          var pt2 = si === ct1 ? pts[0] : pts[si+1];

          if (narea(pt0, pt1, pt2) < tolsq) rpoints.push(pt1);
        }

        return rpoints;
      }

      function decimateDP(pts, tol) {
        var ct = pts.length;

        // marker array
        var mk = new Array(ct);
        mk[0] = mk[ct-1] = true;

        // build the mk array
        decimateDPRecursive(pts, mk, tol, 0, ct-1);

        // result points
        var rpts = [];

        // if a point is marked, include it in the result
        for (var i = 0; i < ct; i++) {
          if (mk[i]) rpts.push(pts[i]);
        }

        return rpts;
      }

      // recursive Douglas-Peucker procedure
      function decimateDPRecursive(pts, mk, tol, i, j) {
        if (i >= j-1) return;

        var tolsq = tol * tol;
        var maxdistsq = 0;
        var idx = -1;

        var distanceToLineSq = MCG.Math.distanceToLineSq;
        var pti = pts[i], ptj = pts[j];

        for (var k = i+1; k < j; k++) {
          var distsq = distanceToLineSq(pti, ptj, pts[k]);
          if (distsq > maxdistsq) {
            maxdistsq = distsq;
            idx = k;
          }
        }

        if (distsq > tolsq) {
          mk[idx] = true;

          decimateDPRecursive(pts, mk, tol, i, idx);
          decimateDPRecursive(pts, mk, tol, idx, j);
        }
      }
    }

  });

  return Polygon;

})();
