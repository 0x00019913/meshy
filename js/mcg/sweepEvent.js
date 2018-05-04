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

    // determine which of two events comes first in a left-right sweep
    sweepcompare: function(other) {
      var a = this, b = other;

      // in case events are the same
      if (a.id === b.id) return 0;

      var pa = a.p, pb = b.p;

      // primary sorting on horizontal coordinate (x if up axis is z)
      var hcomp = pa.h - pb.h;
      if (hcomp !== 0) return hcomp;

      // secondary sorting on vertical coordinate (y if up axis is z)
      var vcomp = pa.v - pb.v;
      if (vcomp !== 0) return vcomp;

      // tertiary sorting on left/right (right goes first so that, given two
      //   segments sharing an endpoint but with no vertical overlap, the left
      //   segment leaves the sweep status structure before the next goes in)
      var lrcomp = a.lrcompare(b);
      if (lrcomp !== 0) return lrcomp;

      // quaternary sorting on slope (increasing)
      var scomp = a.scompare(b);
      if (scomp !== 0) return scomp;

      // quinary sorting on id: there is no meaningful ordering for collinear
      //   segments, so at least pick a unique ordering to be consistent
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

      // quaternary sorting on id: there is no meaningful ordering for collinear
      // segments, so at least pick a unique ordering to be consistent
      return a.id - b.id;
    },

    // return vertical axis comparison for two left events at the later event's
    // horizontal coordinate
    vcompare: function(other) {
      var a = this, b = other;
      var pa = a.p, pb = b.p;
      var pah = pa.h, pbh = pb.h;

      if (pah === pbh) return pa.v - pb.v;

      var f = pah < pbh ? a : b;
      var s = pah < pbh ? b : a;

      // if s is left of f-f.twin, then, at their earliest common horizontal
      // coordinate, s is above f-f.twin; if right, then it's below; else it
      // falls exactly on f-f.twin
      var res = MCG.Math.leftCompare(f.p, f.twin.p, s.p);
      // result is inverted if a is first
      if (pah < pbh) res *= -1;
      return res;
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

      var va = a.vertical(), vb = b.vertical();

      if (va && vb) return 0;
      else if (!va && vb) return -1;
      else if (va && !vb) return 1;

      var pa = a.p, pat = a.twin.p;
      var pb = b.p, pbt = b.twin.p;

      var lc = MCG.Math.leftCompareStrict(pb, pbt, pa);
      var lct = MCG.Math.leftCompareStrict(pb, pbt, pat);

      // if a on b-b.t and a.t on b-b.t, the two segments have the same slope
      if (lc === 0 && lct === 0) return 0;
      // else, if a not right of b-b.t and a.t not left of b-b.t, a's slope is less
      else if (lc != -1 && lct != 1) return -1;
      // else, if a not left of b-b.t and a.t not right of b-b.t, b's slope is less
      else if (lc != 1 && lct != -1) return 1;
      // should never happen (lines don't intersect), but do a literal slope
      // test in case it does
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
          "s", slope===Infinity ? "v" : Math.sign(slope),
          "l", this.p.vectorTo(this.twin.p).length().toFixed(0),
          "w", src.weight,
          "d", src.depthBelow, src.depthBelow + src.weight,
          src.contributing ? "t" : "f"];
      var p =
        [1, 3, 3,
          2, d+3,
          d+3, 1,
          2, d+3,
          d+3, 1,
          2, 2,
          2, 9,
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

    vertical: function() {
      return this.p.h === this.twin.p.h;
    },

    setDepthFromBelow: function(below) {
      var depthBelow = below !== null ? below.depthBelow + below.weight : 0;

      this.depthBelow = depthBelow;
    },

    collinear: function(other) {
      var a = this.parent, b = other.parent;

      var pa = a.parent.p, pat = a.twin.parent.p;
      var pb = b.parent.p, pbt = b.twin.parent.p;

      //if (MCG.Math.coincident(this.p, other.p)) return false;

      // verify that the event pairs actually overlap
      if (a.twin.p.h < b.p.h || a.p.h > b.twin.p.h) return false;
      if (a.twin.p.v < b.p.v || a.p.v > b.twin.p.v) return false;

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

      var pa = a.parent.p, pat = a.twin.parent.p;
      var pb = b.parent.p, pbt = b.twin.parent.p;

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
