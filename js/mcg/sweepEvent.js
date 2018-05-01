Object.assign(MCG.Sweep, (function() {

  function SweepEvent(p, id) {
    this.p = p;
    this.parent = this;
    this.id = id !== undefined ? id : -1;

    this.isLeft = false;
    this.twin = null;
  }

  Object.assign(SweepEvent.prototype, {

    clone: function(p, id) {
      var e = new this.constructor(p, id);

      // copy properties and set point
      Object.assign(e, this);
      e.p = p;
      id = id !== undefined ? id : -1;

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
      var ah = pa.h, bh = pb.h;

      if (ah === bh) return pa.v - pb.v;

      var f = ah < bh ? a : b;
      var s = ah < bh ? b : a;

      // if s is left of f-f.twin, then, at their earliest common horizontal
      // coordinate, s is above f-f.twin; if right, then it's below; else it
      // falls exactly on f-f.twin
      var res = MCG.Math.leftCompare(f.p, f.twin.p, s.p);
      // result is inverted if a is first
      if (ah < bh) res *= -1;
      return res;
    },

    // return left-right comparison for two events (right goes first)
    lrcompare: function(other) {
      if (!this.isLeft && other.isLeft) return -1;
      else if (this.isLeft && !other.isLeft) return 1;
      else return 0;
    },

    // returns slope comparison for two left events that share at least one point:
    //   a's slope is greater if a's twin is to b-b.twin's left (above b);
    //   a's slope is less if a's twin is to b-b.twin's right (below b);
    //   equal slopes if collinear
    scompare: function(other) {
      var pa = this.p, pat = this.twin.p;
      var pb = other.p, pbt = other.twin.p;

      if (MCG.Math.coincident(pb, pat)) {
        return -MCG.Math.leftCompare(pb, pbt, pa);
      }
      else {
        return MCG.Math.leftCompare(pb, pbt, pat);
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

      this.twin.depthBelow = this.depthBelow;
    },

    collinear: function(other) {
      var p = this.p, pt = this.twin.p;
      var po = other.p, pot = other.twin.p;

      if (this.vertical() && other.vertical()) return true;

      var collinear = MCG.Math.collinear;

      return collinear(p, pt, po) && collinear(p, pt, pot);
    },

    endpointsCoincident: function(other) {
      if (MCG.Math.coincident(this.p, other.p)) return true;
      if (MCG.Math.coincident(this.twin.p, other.twin.p)) return true;

      return false;
    },

    intersects: function(other) {
      return MCG.Math.intersect(this.p, this.twin.p, other.p, other.twin.p);
    },

    intersection: function(other) {
      if (this.endpointsCoincident(other)) return null;

      return MCG.Math.intersection(this.p, this.twin.p, other.p, other.twin.p);
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
    }

  });

  return {
    LeftSweepEvent: LeftSweepEvent,
    RightSweepEvent: RightSweepEvent,
    SweepEventFactory: SweepEventFactory
  }
})());
