MCG.Sweep = (function() {

  function sweep(src) {
    if (!src) return;

    var context = src.context;

    var axis = context.axis;
    var ah = context.ah;
    var av = context.av;
    var p = context.p;

    var efactory = new SweepEventFactory(context);

    var resultSet = new MCG.SegmentSet(context);

    var drawEvents = false;
    var printEvents = false;
    var incrHeight = false;

    // priority queue storing events from left to right
    var events = new PriorityQueue({
      comparator: pqComparator
    });

    src.forEachPointPair(addPointPair);

    // structure storing the sweep line status
    var status = new RBTree(rbtComparator);

    var o = 1.0;
    while (events.length > 0) {

      var ev = events.dequeue();

      if (ev.isLeft) {
        var ins = status.insert(ev);

        if (!ins) console.log("insert already existing event");

        var it;

        it = status.findIter(ev);
        var dn = it.prev();
        it = status.findIter(ev);
        var up = it.next();

        ev.setDepthFromBelow(dn);

        eventPrint(ev);
        eventDraw(ev, o, 0x999999);

        if (dn !== null) {
          if (ev.collinear(dn)) {
            handleEventOverlap(ev, dn);
          }
          else {
            handleEventIntersection(ev, dn);
          }
        }

        if (up !== null) {
          if (ev.collinear(up)) {
            handleEventOverlap(ev, up);
          }
          else {
            handleEventIntersection(ev, up);
          }
        }
      }
      else {
        var tev = ev.twin;
        var rem = status.remove(tev);

        eventPrint(ev);

        if (!rem && printEvents) {
          console.log("remove nonexistent event", tev.id, ev.id, pqString());
        }

        if (eventValid(tev)) {
          var pl = tev.p;
          var pr = ev.p;
          if (tev.weight < 0) resultSet.addPointPair(pr, pl);
          else if (tev.weight > 0) resultSet.addPointPair(pl, pr);

          //eventDraw(ev, 0.1, undefined, true);
        }

        eventDraw(ev, o);
      }

      statusDraw(o+0.6);
      o += 1;
    }

    var pset = resultSet.toPolygonSet();
    resultSet.forEachPointPair(function(p1, p2) {
      debug.line(p1.toVector3(), p2.toVector3(), 1, false, 0.1, axis);
    });

    debug.lines();

    return resultSet;

    function addPointPair(p1, p2) {
      // make events
      var e1 = efactory.create(p1, context);
      var e2 = efactory.create(p2, context);

      // link events to each other
      e1.twin = e2;
      e2.twin = e1;

      var vertical = p1.h === p2.h;
      var dir = vertical ? (p1.v < p2.v) : (p1.h < p2.h);

      // assign flags
      // (p1 and p2 assigned s.t. poly interior is on left of p1 -> p2 edge;
      // weight is +1 if vertical line going up through p1 -> p2 edge transitions
      // from outside polygon to inside, else -1)
      // if vertical:
      //  if points up, poly interior is on left, p1 is first (left) point
      //  else, poly interior is on right, p2 is first (left) point
      // else:
      //  if points right, poly interior is up, p1 is first (left) point
      //  else, poly interior is down, p2 is first (left) point
      e1.weight = e2.weight = dir ? 1 : -1;
      e1.isLeft = dir;
      e2.isLeft = !e1.isLeft;

      queue(e1);
      queue(e2);
    }

    function queue(e) {
      events.queue(e);
    }

    // handle collinear overlap between a pair of events
    function handleEventOverlap(a, b) {
      if (a === null || b === null) return;

      // Intersection may look like this (or one may be entirely contained in
      // the other or one or both endpoints may be coincident):
      //
      // p |----x----------| pt
      // q      |----------y----| qt
      //
      // In this case:
      // 1. split at x and y (creates 2 new left and 2 new right events:
      //    xl, xr, yl, yr),
      // 2. queue right event at x (xr) and left event at y (yl),
      // 3. invalidate left event at x and its twin,
      // 4. adjust right event at y and its twin to represent the combined
      //    weights and depths of it and its redundant segment (xl and xl.twin)
      if (printEvents) console.log("COLLINEAR");

      eventPrint(a, "a ");
      eventPrint(b, "b ");

      eventDraw(a, o+0.1);
      eventDraw(b, o+0.2);

      var pa = a.p, pb = b.p;
      var ta = a.twin, tb = b.twin;
      var pta = ta.p, ptb = tb.p;

      // (if a is vertical, both are vertical)
      var vertical = a.vertical();

      // axis on which we'll compare bounds (vertical if segment is vertical,
      // else horizontal)
      var caxis = vertical ? "v" : "h";

      var lcomp = pa[caxis] - pb[caxis];
      var rcomp = pta[caxis] - ptb[caxis];

      // there will be up to two split points, one on the left, another on the
      // right

      // first and second left events
      var lf = lcomp > 0 ? b : a;
      var ls = lcomp > 0 ? a : b;
      // point at which lf will be split
      var pl = lcomp > 0 ? pa : pb;

      // first and second right events
      var rf = rcomp > 0 ? tb : ta;
      var rs = rcomp > 0 ? ta : tb;
      // point at which rs's twin will be split
      var pr = rcomp > 0 ? ptb : pta;

      // left split left event
      var lsplit = null;
      if (lcomp !== 0) {
        lsplit = eventSplit(lf, pl);
        eventPrint(lf, "lf");
        eventPrint(lf, "ls");
        queue(lf.twin);
        queue(lsplit);
        eventPrint(lf.twin, "lr");
        eventPrint(lsplit, "ll");
      }

      if (lcomp !== 0) eventDraw(lf, o+0.3);

      // right split left event
      var rsplit = null;
      if (rcomp !== 0) {
        eventPrint(rf, "rf");
        eventPrint(rs, "rs");
        var rst = rs.twin;
        rsplit = eventSplit(rst, pr);
        queue(rsplit);
        queue(rst.twin);
        eventPrint(rst.twin, "rr");
        eventPrint(rsplit, "rl");
      }

      if (rcomp !== 0) eventDraw(rs.twin, o+0.3);

      // redundant left events; invalidate one and set the other to represent
      // the depths and weights of both

      var lval, linv;
      if (lsplit) {
        lval = lsplit;
        linv = ls;
      }
      else {
        lval = a;
        linv = b;
      }

      eventInvalidate(linv);

      lval.depthBelow = linv.depthBelow;
      lval.weight += linv.weight;

      if (lval.weight === 0) eventInvalidate(lval);

      eventPrint(lval, "lv");
      eventPrint(linv, "li");

      eventDraw(linv, o+0.4);
      eventDraw(lval, o+0.5);
    }

    // handle a possible intersection between a pair of events
    function handleEventIntersection(a, b) {
      if (a === null || b === null) return;

      if (!a.intersects(b)) return;

      var pi = a.intersection(b);

      if (printEvents) console.log("intersection (", pi.h, pi.v, ")");

      eventPrint(a, "sa");
      eventPrint(b, "sb");

      if (pi !== null) {

        eventDraw(a, o+0.1, undefined);
        eventDraw(b, o+0.1, undefined);
        // don't split if the intersection point is on the end of a segment
        var ita = eventSplit(a, pi);
        if (ita !== null) {
          queue(a.twin);
          queue(ita);
          //status.remove(b);
          //queue(b);
        }

        var itb = eventSplit(b, pi);
        if (itb !== null) {
          queue(b.twin);
          queue(itb);
          //status.remove(a);
          //queue(a);
        }

        eventPrint(a, "a ");
        eventPrint(b, "b ");
        eventPrint(ita, "ia");
        eventPrint(itb, "ib");
        eventDraw(a, o+0.2, 0x999999);
        eventDraw(b, o+0.2, 0x999999);
        eventDraw(ita, o+0.3, 0x666666);
        eventDraw(itb, o+0.3, 0x666666);

      }
    }

    function eventInvalidate(e) {
      e.setNoncontributing();

      status.remove(e);
    }

    // given the left endpoint e of an event pair, split it at vertex pi
    // returns newly created left event
    function eventSplit(e, pi) {
      var te = e.twin;

      // if either endpoint is coincident with split point, don't split
      var coincident = MCG.Math.coincident;
      if (coincident(e.p, pi) || coincident(te.p, pi)) return null;

      // right and left events at intersection point
      var ei = efactory.clone(te, pi);
      var ite = efactory.clone(e, pi);

      e.twin = ei;
      te.twin = ite;

      return ite;
    }

    // left event is valid if
    // 1. it is contributing,
    // 2. one side has depth 0 and the other has positive depth
    // (right events are not guaranteed to carry the correct depth information)
    function eventValid(e) {
      if (!e.isLeft) e = e.twin;

      if (!e.contributing) return false;

      var da = e.depthAbove;
      var db = e.depthBelow;

      return (da === 0 && db > 0) || (da > 0 && db === 0);
    }

    function pqString() {
      var iter = status.iterator();
      var result = "[ ";
      var e;

      while ((e = iter.next())!==null) {
        result += e.id + " ";
      }
      result += "]";

      return result;
    }

    function pqPrint(force) {
      if (!printEvents && !force) return;

      console.log(pqString());
    }

    function eventString(e) {
      if (!e) return "null";

      var src = e.isLeft ? e : e.twin;
      var d = 4;
      var diff = src.p.vectorTo(src.twin.p);
      var slope = src.vertical() ? Infinity : diff.v/diff.h;

      var data =
        [e.isLeft ? "L " : "R ", e.id, e.twin.id,
          '(', e.p.h,
          e.p.v, ')',
          '(', e.twin.p.h,
          e.twin.p.v, ')',
          e.p.distanceTo(e.twin.p).toFixed(2),
          "s", slope.toFixed(7),
          "w", src.weight,
          "d", src.depthBelow, src.depthAbove,
          src.contributing ? "t" : "f"];
      var p =
        [1, 3, 3,
          2, d+3,
          d+3, 1,
          2, d+3,
          d+3, 1,
          9,
          2, 11,
          2, 2,
          2, 2, 2,
          1]
      var r = "";
      for (var d=0; d<data.length; d++) r += lpad(data[d], p[d]);

      if (!eventValid(e)) r += " i";

      return r;

      function lpad(s, n) {
        n++;
        var ss = ""+s;
        var l = ss.length;
        return " ".repeat(Math.max(n-l, 0)) + ss;
      }
    }

    function eventPrint(e, pref, force) {
      if (!force && !printEvents) return;

      pref = (pref || "--");
      console.log(pref, eventString(e));
    }

    function eventDraw(e, incr, color, force) {
      if (!e || (!force && !drawEvents)) return;

      incr = incr || 0;
      color = color || eventColor(e);
      debug.oneline(e.p.toVector3(), e.twin.p.toVector3(), incr, axis, color);
    }

    function eventColor(e) {
      if (!e.isLeft) {
        if (eventValid(e.twin)) return 0x66ff66;
        else return 0xff0000;
      }
      else if (e.contributing) return 0xff6666;
      else return 0x6666ff;
    }

    function statusDraw(incr, force) {
      incr = incr || 0;
      var it = status.iterator();
      var e;
      while ((e = it.next()) !== null) {
        if (e.contributing) eventDraw(e, incr, 0x444444, force);
      }
    }
  }

  function pqComparator(a, b) {
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
    var lrcomp = lrcompare(a, b);
    if (lrcomp !== 0) return lrcomp;

    // quaternary sorting on slope (increasing)
    var scomp = scompare(a, b);
    if (scomp !== 0) return scomp;

    // quinary sorting on id: there is no meaningful ordering for collinear
    //   segments, so at least pick a unique ordering to be consistent
    return a.id - b.id;
  }

  function rbtComparator(a, b) {
    if (a.id === b.id) return 0;

    // primary sorting on vertical coordinate at the start of the later event
    // (y if up axis is z)
    var vcomp = vcompare(a, b);
    if (vcomp !== 0) return vcomp;

    // secondary sorting on slope
    var scomp = scompare(a, b);
    if (scomp !== 0) return scomp;

    // quaternary sorting on id: there is no meaningful ordering for collinear
    //   segments, so at least pick a unique ordering to be consistent
    return a.id - b.id;
  }

  // return vertical axis comparison for two left events at the later event's
  // horizontal coordinate
  function vcompare(a, b) {
    var pa = a.p, pb = b.p;
    var ah = pa.h, bh = pb.h;

    if (ah === bh) return pa.v - pb.v;

    var f = ah < bh ? a : b;
    var s = ah < bh ? b : a;

    // if s is left of f-f.twin, then, at their earliest common horizontal
    //   coordinate, s is above f-f.twin; if right, then it's below; else it
    //   falls exactly on f-f.twin
    var res = MCG.Math.leftCompare(f.p, f.twin.p, s.p);
    // result is inverted if a is first
    if (ah < bh) res *= -1;
    return res;
  }

  // return left-right comparison for two events (right goes first)
  function lrcompare(a, b) {
    if (!a.isLeft && b.isLeft) return -1;
    else if (a.isLeft && !b.isLeft) return 1;
    else return 0;
  }

  // returns slope comparison for two left events that share at least one point:
  //   a's slope is greater if a's twin is to b-b.twin's left (above b);
  //   a's slope is less if a's twin is to b-b.twin's right (below b);
  //   equal slopes if collinear
  function scompare(a, b) {
    var pa = a.p, pat = a.twin.p;
    var pb = b.p, pbt = b.twin.p;

    if (MCG.Math.coincident(pb, pat)) {
      return -MCG.Math.leftCompare(pb, pbt, pa);
    }
    else {
      return MCG.Math.leftCompare(pb, pbt, pat);
    }
  }

  function SweepEvent(p) {
    this.p = p || new MCG.Vector();

    this.id = -1;

    this.depthBelow = 0;
    this.depthAbove = 0;

    this.twin = null;
    this.isLeft = false;
    this.weight = 0;

    this.contributing = true;
  }

  SweepEvent.prototype.vertical = function() {
    return this.p.h === this.twin.p.h;
  }

  SweepEvent.prototype.setDepthFromBelow = function(eventBelow) {
    var depthBelow = eventBelow !== null ? eventBelow.depthAbove : 0;

    this.depthBelow = depthBelow;
    this.depthAbove = depthBelow + this.weight;

    this.twin.depthBelow = this.depthBelow;
    this.twin.depthAbove = this.depthAbove;
  }

  SweepEvent.prototype.collinear = function(other) {
    var p = this.p, pt = this.twin.p;
    var po = other.p, pot = other.twin.p;

    var collinear = MCG.Math.collinear;

    return collinear(p, pt, po) && collinear(p, pt, pot);
  }

  SweepEvent.prototype.endpointsCoincident = function(other) {
    if (MCG.Math.coincident(this.p, other.p)) return true;
    if (MCG.Math.coincident(this.twin.p, other.twin.p)) return true;

    return false;
  }

  // interpolate event's value at horizontal coordinate h
  SweepEvent.prototype.interpolate = function(h) {
    var p = this.p;

    if (this.vertical() || p.h === h) return p.v;
    else {
      var pt = this.twin.p;
      return Math.round(p.v + (h - p.h) * (pt.v - p.v) / (pt.h - p.h));
    }
  }

  SweepEvent.prototype.intersects = function(other) {
    return MCG.Math.intersect(this.p, this.twin.p, other.p, other.twin.p);
  }

  SweepEvent.prototype.intersection = function(other) {
    if (this.endpointsCoincident(other)) return null;

    return MCG.Math.intersection(this.p, this.twin.p, other.p, other.twin.p);
  }

  SweepEvent.prototype.clone = function(p) {
    var e = new this.constructor(p);

    // copy properties and set point
    Object.assign(e, this);
    e.p = p;

    return e;
  }

  SweepEvent.prototype.setNoncontributing = function() {
    this.contributing = false;
    this.twin.contributing = false;
  }

  function SweepEventFactory() {
    this.id = 0;
  }

  SweepEventFactory.prototype.create = function(p) {
    var e = new SweepEvent(p);
    e.id = this.id++;

    return e;
  }

  SweepEventFactory.prototype.clone = function(e, p) {
    var ne = e.clone(p);
    ne.id = this.id++;

    return ne;
  }

  return {
    sweep: sweep
  };

})();
