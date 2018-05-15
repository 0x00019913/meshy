Object.assign(MCG.Sweep, (function() {

  function SweepEvent(p, id) {
    // MCG.Vector at which this event is located
    this.p = p;

    // store parent for testing collinearity and slopes - this prevents drift
    // from multiple split points snapping to the integer grid
    this.parent = this;

    // used as a last-resort ordering criterion for events; the factory
    // guarantees that event ids are unique
    this.id = id !== undefined ? id : -1;

    this.isLeft = false;
    this.twin = null;
  }

  Object.assign(SweepEvent.prototype, {

    clone: function(p, id) {
      var e = new this.constructor(p);

      // copy properties and set point
      Object.assign(e, this);
      e.p = p;
      e.id = id !== undefined ? id : -1;

      return e;
    },

    vertical: function() {
      return this.p.h === this.twin.p.h;
    },

    horizontal: function() {
      return this.p.v === this.twin.p.v;
    },

    // determine which of two events comes first in a left-right sweep
    sweepcompare: function(other) {
      var a = this, b = other;

      // in case events are the same
      if (a.id === b.id) return 0;

      var pa = a.p, pb = b.p;

      // primary sorting on horizontal coordinate (x if up axis is z)
      var hcomp = pa.hcompare(pb);
      if (hcomp !== 0) return hcomp;

      // secondary sorting on vertical coordinate (y if up axis is z)
      var vcomp = pa.vcompare(pb);
      if (vcomp !== 0) return vcomp;

      // tertiary sorting on left/right (right goes first so that, given two
      //   segments sharing an endpoint but with no vertical overlap, the first
      //   segment leaves the sweep status structure before the next goes in)
      var lrcomp = a.lrcompare(b);
      if (lrcomp !== 0) return lrcomp;

      // quaternary sorting on slope (increasing)
      var scomp = a.scompare(b);
      if (scomp !== 0) return scomp;

      // further comparisons based on parent extents

      // parent comparison function
      var pcompare = a.vertical() || b.vertical() ? "vcompare" : "hcompare";

      var pcomp = a.parent.p[pcompare](b.parent.p);
      if (pcomp !== 0) return pcomp;

      var ptcomp = a.twin.parent.p[pcompare](b.twin.parent.p);
      if (ptcomp !== 0) return ptcomp;

      return a.id - b.id;
    },

    // comparison for two left events along a vertical line passing through both
    // at the earliest point where they have vertical overlap (i.e., horizontal
    // coordinate of the later event)
    linecompare: function(other) {
      var a = this, b = other;

      if (a.id === b.id) return 0;

      // primary sorting on vertical coordinate at the start of the later event
      // (y if up axis is z)
      var vcomp = a.vcompare(b);
      if (vcomp !== 0) return vcomp;

      // secondary sorting on slope
      var scomp = a.scompare(b);
      if (scomp !== 0) return scomp;

      // further comparisons based on parent extents

      // parent comparison function
      var pcompare = a.vertical() || b.vertical() ? "vcompare" : "hcompare";

      var pcomp = a.parent.p[pcompare](b.parent.p);
      if (pcomp !== 0) return pcomp;

      var ptcomp = a.twin.parent.p[pcompare](b.twin.parent.p);
      if (ptcomp !== 0) return ptcomp;

      return a.id - b.id;
    },

    // return left-right comparison for two events (right goes first)
    lrcompare: function(other) {
      if (!this.isLeft && other.isLeft) return -1;
      else if (this.isLeft && !other.isLeft) return 1;
      else return 0;
    },

    // returns slope comparison for two events that share at least one point:
    //   a's slope is greater if a's twin is to b-b.twin's left (above b);
    //   a's slope is less if a's twin is to b-b.twin's right (below b);
    //   equal slopes if collinear
    scompare: function(other) {
      var a = this.isLeft ? this : this.twin;
      var b = other.isLeft ? other : other.twin;

      // basic checks if one or both are vertical
      var va = a.vertical(), vb = b.vertical();

      if (va && vb) return 0;
      else if (!va && vb) return -1;
      else if (va && !vb) return 1;

      var pa = a.p, pat = a.twin.p;
      var pb = b.p, pbt = b.twin.p;

      var lc = MCG.Math.leftCompare(pb, pbt, pa);
      var lct = MCG.Math.leftCompare(pb, pbt, pat);

      // if a on b-b.t and a.t on b-b.t, the two segments have the same slope
      if (lc === 0 && lct === 0) {
        // it's possible that events testing as parallel are actually
        // antiparallel, so one has the greater slope
        var cva = Math.sign(pa.vcompare(pat)), cvb = Math.sign(pb.vcompare(pbt));
        if (cva > cvb) return -1;
        else if (cva < cvb) return 1;

        // segments are parallel
        return 0;
      }
      // else, if a not right of b-b.t and a.t not left of b-b.t, a's slope is less
      else if (lc != -1 && lct != 1) return -1;
      // else, if a not left of b-b.t and a.t not right of b-b.t, b's slope is less
      else if (lc != 1 && lct != -1) return 1;
      // should never happen (lines don't intersect), but do a literal slope
      // test just in case
      else {
        var ah = pa.h, ath = pat.h;
        var bh = pb.h, bth = pbt.h;
        var sa = ah === ath ? Infinity : (pat.v - pa.v) / (ath - ah);
        var sb = bh === bth ? Infinity : (pbt.v - pb.v) / (bth - bh);

        return Math.sign(sa - sb);
      }
    },

    toString: function(pref) {
      pref = (pref || "--");

      var src = this.isLeft ? this : this.twin;
      var d = 4;
      var diff = src.p.vectorTo(src.twin.p);
      var slope = src.vertical() ? Infinity : diff.v/diff.h;

      var data =
        [this.isLeft ? "L " : "R ", this.id, this.twin.id,
          '(', this.p.h,
          this.p.v, ')',
          '(', this.twin.p.h,
          this.twin.p.v, ')',
          slope===Infinity ? "v" : (Math.sign(slope)==1 ? "+" : (Math.sign(slope)==-1 ? "-" : 0)),
          this.p.vectorTo(this.twin.p).length().toFixed(0),
          "w", src.weight,
          "d", src.depthBelow, src.depthBelow + src.weight,
          src.contributing ? "t" : "f"];
      var p =
        [1, 4, 4,
          2, d+3,
          d+3, 1,
          2, d+3,
          d+3, 1,
          2,
          9,
          2, 2,
          2, 2, 2,
          1]
      var r = "";
      for (var d=0; d<data.length; d++) r += lpad(data[d], p[d]);

      return pref + " " + r;

      function lpad(s, n) {
        n++;
        var ss = ""+s;
        var l = ss.length;
        return " ".repeat(Math.max(n-l, 0)) + ss;
      }
    }

  });


  function RightSweepEvent(p, id) {
    SweepEvent.call(this, p, id);
  }

  RightSweepEvent.prototype = Object.create(SweepEvent.prototype);
  Object.assign(RightSweepEvent.prototype, {
    constructor: RightSweepEvent
  });


  function LeftSweepEvent(p, id) {
    SweepEvent.call(this, p, id);

    this.isLeft = true;

    this.depthBelow = 0;
    this.weight = 0;

    this.contributing = true;
  }

  LeftSweepEvent.prototype = Object.create(SweepEvent.prototype);

  Object.assign(LeftSweepEvent.prototype, {

    constructor: LeftSweepEvent,

    setDepthFromBelow: function(below) {
      var depthBelow = below !== null ? below.depthBelow + below.weight : 0;

      this.depthBelow = depthBelow;
    },

    // return vertical axis comparison for two left events at the later event's
    // horizontal coordinate
    vcompare: function(other) {
      var a = this, b = other;
      var pa = a.p, pb = b.p;
      var pah = pa.h, pbh = pb.h;

      var pav = pa.v, pbv = pb.v;

      // if events horizontally coincident, just test the vertical coordinate
      if (pah === pbh) return pav - pbv;

      var patv = a.twin.p.v, pbtv = b.twin.p.v;

      // if no horizontal overlap, decide by which is higher/lower
      if (Math.max(pav, patv) < Math.min(pbv, pbtv)) return -1;
      if (Math.max(pbv, pbtv) < Math.min(pav, patv)) return 1;

      var f = pah < pbh ? a : b;
      var s = pah < pbh ? b : a;

      var h = Math.max(pah, pbh);

      var result = Math.sign(s.p.v - f.interpolate(h));
      if (pah < pbh) result *= -1;

      return result;
    },

    // interpolate a (non-vertical) left event's segment to a given horizontal
    // coordinate
    interpolate: function(h) {
      var pa = this.p, pat = this.twin.p;

      return pa.v + (pat.v - pa.v) * (h - pa.h) / (pat.h - pa.h);
    },

    collinear: function(other) {
      var a = this, b = other;

      var pa = a.p, pat = a.twin.p;
      var pb = b.p, pbt = b.twin.p;

      // verify that the event pairs actually overlap
      if (a.horizontal() && b.horizontal()) {
        if (Math.max(pa.h, pat.h) <= Math.min(pb.h, pbt.h)) return false;
        if (Math.max(pb.h, pbt.h) <= Math.min(pa.h, pat.h)) return false;
      }
      else {
        if (Math.max(pa.v, pat.v) <= Math.min(pb.v, pbt.v)) return false;
        if (Math.max(pb.v, pbt.v) <= Math.min(pa.v, pat.v)) return false;
      }

      if (a.vertical() && b.vertical()) return true;

      var collinear = MCG.Math.collinear;

      return collinear(pa, pat, pb) && collinear(pa, pat, pbt);
    },

    endpointsCoincident: function(other) {
      if (MCG.Math.coincident(this.p, other.p)) return true;
      if (MCG.Math.coincident(this.twin.p, other.twin.p)) return true;

      return false;
    },

    // returns MCG.Math.IntersectionFlags
    intersects: function(other) {
      var a = this, b = other;

      var pa = a.p, pat = a.twin.p;
      var pb = b.p, pbt = b.twin.p;

      return MCG.Math.intersect(pa, pat, pb, pbt);
    },

    intersection: function(other) {
      var a = this, b = other;

      if (a.endpointsCoincident(b)) return null;

      var pa = a.p, pat = a.twin.p;
      var pb = b.p, pbt = b.twin.p;

      return MCG.Math.intersection(pa, pat, pb, pbt);
    },

    setNoncontributing: function() {
      this.contributing = false;
    }

  });



  function SweepEventFactory() {
    this.id = 0;
  }

  Object.assign(SweepEventFactory.prototype, {
    createLeft: function(p) {
      return new LeftSweepEvent(p, this.id++);
    },

    createRight: function(p) {
      return new RightSweepEvent(p, this.id++);
    },

    clone: function(e, p) {
      return e.clone(p, this.id++);
    },

    count: function() {
      return this.id;
    }

  });

  return {
    LeftSweepEvent: LeftSweepEvent,
    RightSweepEvent: RightSweepEvent,
    SweepEventFactory: SweepEventFactory
  }
})());
