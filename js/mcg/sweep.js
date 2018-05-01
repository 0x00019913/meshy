Object.assign(MCG.Sweep, (function() {

  function sweep(src0, src1, dbg) {
    if (!src0) return;

    var context = src0.context;

    var axis = context.axis;
    var ah = context.ah;
    var av = context.av;
    var p = context.p;

    var efactory = new MCG.Sweep.SweepEventFactory(context);

    var resultSet = new MCG.SegmentSet(context);

    var drawEvents = dbg;
    var printEvents = dbg;

    // priority queue storing events from left to right
    var events = new PriorityQueue({
      comparator: function(a, b) { return a.sweepcompare(b); }
    });

    src0.forEachPointPair(addPointPair);
    if (src1 !== undefined) src1.forEachPointPair(addPointPair);

    // structure storing the sweep line status
    var status = new RBTree(
      function(a, b) { return a.linecompare(b); }
    );

    var o = 1.0;
    var ct = 0;
    while (events.length > 0) {
      if (ct++ > 100) break;

      var ev = events.dequeue();

      if (ev.isLeft) {
        var ins = status.insert(ev);

        if (!ins && printEvents) console.log("insert already existing event");

        var it;

        it = status.findIter(ev);
        var dn = it.prev();
        it = status.findIter(ev);
        var up = it.next();

        ev.setDepthFromBelow(dn);

        eventPrint(ev);
        eventDraw(ev, o, 0x999999);

        handleAdjacentEvents(ev, dn);
        handleAdjacentEvents(up, ev);
      }
      else {
        var tev = ev.twin;
        var rem = status.remove(tev);

        eventPrint(ev);

        if (!rem && printEvents && tev.contributing) {
          console.log("remove nonexistent event", tev.id, ev.id, pqString());
        }

        if (eventValid(tev)) {
          var pf = tev.weight < 0 ? ev.p : tev.p;
          var ps = tev.weight < 0 ? tev.p : ev.p;

          resultSet.addPointPair(pf, ps);

          //eventDraw(ev, 0.1, undefined, true);
        }

        eventDraw(ev, o);
      }

      statusDraw(o+0.6);
      o += 1;
    }

    debug.lines();

    return resultSet;


    // create an event pair for a p1-p2 segment
    function addPointPair(p1, p2) {
      // determine direction: if dir, p1 is left and p2 is right; reverse if !dir
      var vertical = p1.h === p2.h;
      var dir = vertical ? (p1.v < p2.v) : (p1.h < p2.h);

      // make events
      var el = efactory.createLeft(dir ? p1 : p2);
      var er = efactory.createRight(dir ? p2 : p1);

      // weight is +1 if vertical line going up through p1 -> p2 edge transitions
      // from outside polygon to inside, else -1)
      el.weight = dir ? 1 : -1;

      // link events to each other
      el.twin = er;
      er.twin = el;

      queue(el);
      queue(er);
    }

    function queue(e) {
      events.queue(e);
    }

    // handle (possibly collinear) intersection between a pair of left events
    function handleAdjacentEvents(a, b) {
      if (a === null || b === null) return null;

      if (a.collinear(b)) {
        return handleCollinearEvents(a, b);
      }
      else if (a.intersects(b)) {
        return handleEventIntersection(a, b);
      }
    }

    // handle collinear overlap between a pair of events
    function handleCollinearEvents(a, b) {
      // Overlap may look like this (or one may be entirely contained in
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

      // if one is vertical, both are close enough to vertical
      var vertical = a.vertical() || b.vertical();

      // compare bounds for left events and right events
      var lcomp = vertical ? pa.vcompare(pb) : pa.hcompare(pb);
      var rcomp = vertical ? pta.vcompare(ptb) : pta.hcompare(ptb);

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
        eventPrint(ls, "ls");
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
        }
        else {
          queue(a);
        }

        var itb = eventSplit(b, pi);
        if (itb !== null) {
          queue(b.twin);
          queue(itb);
        }
        else {
          queue(b);
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

      status.remove(e);

      // if either endpoint is coincident with split point, don't split
      var coincident = MCG.Math.coincident;
      if (coincident(e.p, pi) || coincident(te.p, pi)) return null;

      // right and left events at intersection point
      var ei = efactory.clone(te, pi);
      var ite = efactory.clone(e, pi);

      e.twin = ei;
      te.twin = ite;

      status.insert(e);

      return ite;
    }

    // left event is valid if
    // 1. it is contributing,
    // 2. one side has depth 0 and the other has positive depth
    // (right events are not guaranteed to carry the correct depth information)
    function eventValid(e) {
      if (!e.isLeft) e = e.twin;

      if (!e.contributing) return false;

      var da = e.depthBelow + e.weight;
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
          "s", Math.sign(slope),
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

  return {
    sweep: sweep
  };

})());
