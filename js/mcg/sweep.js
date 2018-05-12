Object.assign(MCG.Sweep, (function() {

  function sweep(src0, src1, dbg) {
    if (!src0) return null;

    var context = src0.context;

    var axis = context.axis;
    var ah = context.ah;
    var av = context.av;
    var p = context.p;

    var efactory = new MCG.Sweep.SweepEventFactory(context);

    var resultSet = new MCG.SegmentSet(context);

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

    var a = null, b = null;
    while (events.length>0) {
      break;
      var ev = events.dequeue();
      eventPrint(ev, "ev", dbg);
      if (ev.id==6) a = ev;
      if (ev.id==14) b = ev;
    }

    if (dbg && a && b) {
      var pa = a.p, pat = a.twin.p;
      var pb = b.p, pbt = b.twin.p;

      var hcomp = pa.hcompare(pb);
      var vcomp = pa.vcompare(pb);
      var lrcomp = a.lrcompare(b);
      var scomp = a.scompare(b);
      var pcompare = a.vertical() || b.vertical() ? "vcompare" : "hcompare";
      var pcomp = a.parent.p[pcompare](b.parent.p);
      var ptcomp = a.twin.parent.p[pcompare](b.twin.parent.p);

      eventPrint(a, "a ", dbg);
      console.log(hcomp, vcomp, lrcomp, scomp, pcomp, ptcomp, Math.sign(pa.vcompare(pat)), Math.sign(pb.vcompare(pbt)), a.collinear(b));
      eventPrint(b, "b ", dbg);
    }

    var o = 1.0;
    var ct = 0, lim = Infinity;
    while (events.length > 0) {
      if (ct++ > lim) {
        console.log("exceeded event limit", lim);
        break;
      }

      var ev = events.dequeue();

      var printEvents = dbg;
      var drawEvents = false;
      var incr = 0.1;

      if (ev.isLeft) {
        if (!ev.contributing) continue;

        var ins = status.insert(ev);

        if (!ins && printEvents) console.log("insert already existing event", ev.id, ev.twin.id, statusString());

        var it = status.findIter(ev);
        if (!it) console.log("failed to find inserted event", ev.id, ev.twin.id);
        var dn = it.prev();
        it.next();
        var up = it.next();

        ev.setDepthFromBelow(dn);

        eventPrint(ev);
        eventDraw(ev, o, 0x999999);

        //if (up) eventPrint(up, "up");
        if (dn) eventPrint(dn, "dn");
        statusPrintShort();

        handleAdjacentEvents(up, ev);
        handleAdjacentEvents(ev, dn);
      }
      else {
        var tev = ev.twin;

        var dn = null, up = null;

        if (tev.contributing) {
          var it = status.findIter(tev);
          if (!it) console.log("failed to find twin event", tev.id, ev.id);
          dn = it.prev();
          it.next();
          up = it.next();
        }

        var rem = status.remove(tev);

        eventPrint(ev);

        if (!rem && tev.contributing) {
          if (printEvents) {
            console.log("remove nonexistent event", tev.id, ev.id, statusString());
            debug.point(ev.p.toVector3(), 0.225, axis);
            debug.point(tev.p.toVector3(), 0.225, axis);

            statusPrint();
          }
        }

        if (eventValid(tev)) {
          var pf = tev.weight < 0 ? ev.p : tev.p;
          var ps = tev.weight < 0 ? tev.p : ev.p;

          resultSet.addPointPair(pf, ps);
        }
        else if (printEvents) {
          //debug.line(ev.p.toVector3(), tev.p.toVector3(), 1, false, 0.1875, context.axis);
        }

        handleIntersectingEvents(up, dn);

        eventDraw(ev, o);
      }

      statusDraw(o+incr*6);
      if (drawEvents) o += incr*10;
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

      return el;
    }

    // if an event pair's left-right events are in the incorrect order (this can
    // occur when splitting events), recreate the event pair
    function handleSwappedEventPair(ev) {
      var correct = (ev.vertical() ? ev.p.vcompare(ev.twin.p) : ev.p.vcompare(ev.twin.p)) < 0;

      if (correct) return;

      eventInvalidate(ev);

      var tev = ev.twin;

      var p1 = ev.weight > 0 ? ev.p : tev.p;
      var p2 = ev.weight > 0 ? tev.p : ev.p;

      var el = addPointPair(p1, p2);

      // assign weight and reverse sign if event pair points were flipped
      el.weight = ev.p === el.p ? ev.weight : -ev.weight;
    }

    function queue(e) {
      events.queue(e);
    }

    function requeue(e) {
      status.remove(e);
      queue(e);
    }

    // handle (possibly collinear) intersection between a pair of left events
    function handleAdjacentEvents(a, b) {
      if (a === null || b === null) return null;

      if (a.collinear(b)) {
        return handleCollinearEvents(a, b);
      }
      else {
        return handleIntersectingEvents(a, b);
      }
    }

    // handle collinear overlap between a pair of events
    function handleCollinearEvents(a, b) {
      // Overlap may look like this (or one may be entirely contained in
      // the other or one or both endpoints may be coincident):
      //
      // p |----x----------| p.t
      // q      |----------y----| q.t
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

      eventDraw(a, o+incr*1);
      eventDraw(b, o+incr*2);

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
        var rm = status.remove(lf);
        lsplit = eventSplit(lf, pl);
        eventPrint(lf, "lf");
        eventPrint(ls, "ls");
        queue(lf.twin);
        queue(lsplit);
        eventPrint(lf.twin, "lr");
        eventPrint(lsplit, "ll");
        if (rm) status.insert(lf);
      }

      if (lcomp !== 0) eventDraw(lf, o+incr*3);

      // right split left event
      var rsplit = null;
      if (rcomp !== 0) {
        eventPrint(rf, "rf");
        eventPrint(rs, "rs");
        var rst = rs.twin;
        //var rm = status.remove(rst);
        rsplit = eventSplit(rst, pr);
        queue(rsplit);
        queue(rst.twin);
        eventPrint(rst.twin, "rr");
        eventPrint(rsplit, "rl");
        //if (rm) status.insert(rst);
      }

      if (rcomp !== 0) eventDraw(rs.twin, o+incr*3);

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

      eventDraw(linv, o+incr*4);
      eventDraw(lval, o+incr*5);
    }

    // handle a possible intersection between a pair of events
    function handleIntersectingEvents(a, b) {
      if (a === null || b === null) return null;

      var flags = MCG.Math.IntersectionFlags;
      var intersect = a.intersects(b);

      var pa = a.p, pat = a.twin.p;
      var pb = b.p, pbt = b.twin.p;

      // intersection point
      var pi;

      if (intersect === flags.intermediate) pi = a.intersection(b);
      else if (intersect === flags.a0) pi = pa;
      else if (intersect === flags.a1) pi = pat;
      else if (intersect === flags.b0) pi = pb;
      else if (intersect === flags.b1) pi = pbt;
      // if no intersection or intersection at two endpoints
      else pi = null;

      if (pi && printEvents) {
        console.log("intersection (", pi.h, pi.v, ")", intersect);

        eventPrint(a, "sa");
        eventPrint(b, "sb");
      }

      if (pi !== null) {
        eventDraw(a, o+incr*1, undefined);
        eventDraw(b, o+incr*1, undefined);

        var va = a.vertical(), vb = b.vertical();

        var coincident = MCG.Math.coincident;
        var ita = null, itb = null;

        // if one event is split at the other's start, both events will end up
        // in the status structure while having only one point of vertical
        // overlap; remove the second event and requeue it so that the split
        // event can leave first
        var ca = coincident(a.p, pi) || coincident(a.twin.p, pi);
        var cb = coincident(b.p, pi) || coincident(b.twin.p, pi);

        if (ca) requeue(a);
        if (cb) requeue(b);

        if (!ca) {
          ita = eventSplit(a, pi);

          queue(a.twin);
          queue(ita);

          // if vertical status changed for either segment, it's possible that
          // the left and right events swapped
          if (a.vertical() !== va) handleSwappedEventPair(a);
          if (ita.vertical() !== va) handleSwappedEventPair(ita);
        }
        if (!cb) {
          itb = eventSplit(b, pi);

          queue(b.twin);
          queue(itb);

          if (b.vertical() !== vb) handleSwappedEventPair(b);
          if (itb.vertical() !== vb) handleSwappedEventPair(itb);
        }

        eventPrint(a, "a ");
        eventPrint(b, "b ");
        eventPrint(ita, "ia");
        eventPrint(itb, "ib");
        eventDraw(a, o+incr*2, 0x999999);
        eventDraw(b, o+incr*2, 0x999999);
        eventDraw(ita, o+incr*3, 0x666666);
        eventDraw(itb, o+incr*3, 0x666666);

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

      var da = e.depthBelow + e.weight;
      var db = e.depthBelow;

      return (da < 1 && db > 0) || (da > 0 && db < 1);
    }

    function statusString() {
      var iter = status.iterator();
      var result = "[ ";
      var e;

      while ((e = iter.next())!==null) {
        result += e.id + " ";
      }
      result += "]";

      return result;
    }

    function statusPrintShort(force) {
      if (!printEvents && !force) return;

      console.log(statusString());
    }

    function statusPrint(force) {
      if (!printEvents && !force) return;

      var iter = status.iterator(), e, p = null;
      while ((e = iter.prev()) !== null) {
        if (p) {
          console.log(p.vcompare(e), e.vcompare(p), p.scompare(e), e.scompare(p));
        }
        eventPrint(e, "N ", force);
        p = e;
      }
    }

    function eventPrint(e, pref, force) {
      if (!force && !printEvents) return;

      if (e===null) console.log(pref, "null");
      else if (e===undefined) console.log(pref, "undefined");
      else console.log(e.toString(pref));
    }

    function eventDraw(e, offset, color, force) {
      if (!e || (!force && !drawEvents)) return;

      offset = offset || 0;
      color = color || eventColor(e);
      debug.oneline(e.p.toVector3(), e.twin.p.toVector3(), offset, axis, color);
    }

    function eventColor(e) {
      if (!e.isLeft) {
        if (eventValid(e.twin)) return 0x66ff66;
        else return 0xff0000;
      }
      else if (e.contributing) return 0xff6666;
      else return 0x6666ff;
    }

    function statusDraw(offset, force) {
      offset = offset || 0;
      var it = status.iterator();
      var e;
      var ooo = 0;
      while ((e = it.next()) !== null) {
        if (e.contributing) eventDraw(e, offset+ooo, 0x444444, force);
        ooo += 0.02;
      }
    }
  }

  return {
    sweep: sweep
  };

})());
