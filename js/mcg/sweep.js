Object.assign(MCG.Sweep, (function() {

  var printEvents = false;
  var drawEvents = false;
  var incr = 0;

  function sweep(operation, srcA, srcB, dbg) {
    if (!srcA) return null;

    var context = srcA.context;

    var axis = context.axis;
    var ah = context.ah;
    var av = context.av;
    var p = context.p;

    // the farthest event that has occurred (with respect to the scanline) -
    // used to catch events that were created in the past
    var front = null;

    var efactory = new MCG.Sweep.SweepEventFactory(context);

    var store = operation.initStore(context, srcA, srcB);

    // priority queue storing events from left to right
    var events = new PriorityQueue({
      comparator: function(a, b) { return a.sweepcompare(b); }
    });

    // structure storing the sweep line status
    var status = new RBTree(
      function(a, b) { return a.linecompare(b); }
    );

    // add events for srcA
    srcA.forEachPointPair(addPointPairA);

    // if available, also add for srcB
    if (srcB !== undefined) srcB.forEachPointPair(addPointPairB);

    // process events in order

    var o = 1.0;
    var ct = 0, lim = dbg ? 3000 : 100000;
    while (events.length > 0) {
      if (ct++ > lim) {
        if (!dbg) throw "exceeded event limit " + lim;
        console.log("exceeded event limit " + lim);
        break;
      }

      var ev = dequeue();

      printEvents = dbg && inRange(ev.p.h, 3.0*p, 4.0*p) && inRange(ev.p.v, 9.2*p, 9.5*p);
      drawEvents = false;
      incr = 0.1;

      if (ev.isLeft) {
        if (!ev.contributing) continue;

        var ins = insert(ev);

        var [up, dn] = eventGetAdjacent(ev);

        ev.setDepthFromBelow(dn);

        handlePastEvent(ev);

        eventPrint(ev);
        eventDraw(ev, o, 0x999999);

        if (up) eventPrint(up, "up");
        if (dn) eventPrint(dn, "dn");

        //if (!statusValid()) statusPrint();

        handleEventIntersection(ev, dn);
        handleEventIntersection(up, ev);

        //depthValidate();
      }
      else {
        var tev = ev.twin;

        eventPrint(ev);

        var up = null, dn = null;

        // removing an event causes its two adjacent events to become adjacent
        // to each other, so they may intersect
        if (tev.contributing) [up, dn] = eventGetAdjacent(tev);

        // handle possible intersection
        var pi = handleEventIntersection(up, dn);

        // if intersection between adjacent events happens earlier in time
        // (special case that can occur when points snap to the grid), return
        // the currnt event and its twin to the queue and reprocess them to
        // maintain correct depth
        if (pi && pi.h < ev.p.h) {
          queue(tev);
          queue(ev);
        }
        // else, just handle the right event
        else {
          handleRightEvent(ev);
        }

        eventDraw(ev, o);
      }

      statusPrintShort();

      statusDraw(o+incr*6);
      if (drawEvents) o += incr*10;
    }

    debug.lines();

    return store.result;


    // create an event pair for a p1-p2 segment
    function createPointPair(p1, p2, wA, wB) {
      if (MCG.Math.coincident(p1, p2)) return null;

      // determine direction: if dir, p1 is left and p2 is right; reverse if !dir
      var vertical = p1.h === p2.h;
      var dir = vertical ? (p1.v < p2.v) : (p1.h < p2.h);

      // make events
      var el = efactory.createLeft(dir ? p1 : p2);
      var er = efactory.createRight(dir ? p2 : p1);

      // weight is +1 if vertical line going up through p1 -> p2 edge transitions
      // from outside polygon to inside, else -1)
      el.weightA = dir ? wA : -wA;
      el.weightB = dir ? wB : -wB;

      // link events to each other
      el.twin = er;
      er.twin = el;

      return el;
    }

    // create and queue an event pair for a p1-p2 segment
    function addPointPair(p1, p2, wA, wB) {
      var el = createPointPair(p1, p2, wA, wB);

      if (el === null) return null;

      var er = el.twin;

      queue(el);
      queue(er);

      return el;
    }

    // functions for adding source A and B
    function addPointPairA(p1, p2) {
      return addPointPair(p1, p2, 1, 0);
    }
    function addPointPairB(p1, p2) {
      return addPointPair(p1, p2, 0, 1);
    }

    // if an event pair's left-right events are in the incorrect order (this can
    // occur when splitting events), recreate the event pair
    function handleSwappedEventPair(ev) {
      var tev = ev.twin;
      var vertical = ev.vertical();

      var compare = vertical ? ev.p.vcompare(tev.p) : ev.p.hcompare(tev.p);
      if (compare < 0) return ev;

      if (printEvents) {
        console.log("handled swapped pair");
        eventPrint(ev);
      }

      var rm = eventInvalidate(ev);

      var el = createPointPair(tev.p, ev.p);

      if (el === null) return null;

      // assign weight and depth
      el.setWeightFrom(ev, true);
      el.depthBelowA = ev.depthBelowA + ev.weightA;
      el.depthBelowB = ev.depthBelowB + ev.weightB;

      queue(el.twin);

      if (!el.vertical()) {
        if (rm) insert(el);
      }

      return el;
    }

    function eventGetAdjacent(ev) {
      var it = status.findIter(ev);

      if (!it) {
        var present = false;
        var iter = status.iterator();
        var e;
        while ((e=iter.next()) !== null) {
          if (e==ev) {
            present = true;
            break;
          }
        }
        if (present) {
          if (!dbg) throw "failed to find event in status " + ev.id + " " + ev.twin.id;
          console.log("failed to find event in status", ev.id, ev.twin.id);
          statusPrint();
        }
      }

      var prev = null, next = null;
      if (it) {
        prev = it.prev();
        it.next();
        next = it.next();
      }

      return [next, prev];
    }

    function queue(e) {
      if (e === null) return false;
      return events.queue(e);
    }

    function dequeue() {
      return events.dequeue();
    }

    function requeue(e) {
      if (e === null) return null;

      remove(e);
      return queue(e);
    }

    function insert(e) {
      var ins = status.insert(e);

      if (!ins && printEvents) {
        console.log("insert already existing event", e.id, e.twin.id, statusString());
      }

      return ins;
    }

    function remove(e) {
      var rm = status.remove(e);

      if (!rm && e.contributing && printEvents) {
        console.log("remove nonexistent event", e.id, e.twin.id, statusString());
      }

      return rm;
    }

    function handleRightEvent(e) {
      var te = e.twin;

      operation.handleEvent(te, status, store);

      return remove(te);
    }

    function depthValidate() {
      var iter = status.iterator();
      var e, p = null;
      while ((e = iter.next()) !== null) {
        if (p) {
          var vA = e.depthBelowA === (p.depthBelowA + p.weightA);
          var vB = e.depthBelowB === (p.depthBelowB + p.weightB);
          if (!vA || !vB) {
            eventPrint(e, "!a");
            eventPrint(p, "!b");
          }
        }

        p = e;
      }
    }

    function depthCorrect(e) {
      var iter = status.findIter(e);
      var c, p = e;

      while ((c = iter.next()) !== null) {
        if (c.timeCompare(e) !== -1) {
          c.setDepthFromBelow(p);
          if (printEvents) console.log("corrected depth", p.id, c.id, "from", e.id);
        }

        p = c;
      }
    }

    function handlePastEvent(e) {
      if (front === null) {
        front = e;
        return;
      }

      var tc = e.timeCompare(front);

      if (tc === 1) front = e;
      else depthCorrect(e);
    }

    // handle a possible intersection between a pair of events
    function handleEventIntersection(a, b) {
      if (a === null || b === null) return null;
      if (!a.contributing || !b.contributing) return null;

      var flags = MCG.Math.IntersectionFlags;
      var intersection = a.intersects(b);

      var pa = a.p, pb = b.p;
      var ta = a.twin, tb = b.twin;
      var pta = ta.p, ptb = tb.p;
      if (printEvents) {
        var lc = MCG.Math.leftCompare;
        var dl = MCG.Math.distanceToLine;
        var labc = lc(pa, pta, pb), labd = lc(pa, pta, ptb);
        var lcda = lc(pb, ptb, pa), lcdb = lc(pb, ptb, pta);
        var dabc = dl(pa, pta, pb), dabd = dl(pa, pta, ptb);
        var dcda = dl(pb, ptb, pa), dcdb = dl(pb, ptb, pta);
        console.log(intersection, labc, labd, lcda, lcdb, dabc, dabd, dcda, dcdb);
      }

      // if collinear, need to do special handling
      if (intersection === flags.collinear) {
        // verify that the event pairs actually overlap
        if (a.horizontal() || b.horizontal()) {
          if (Math.max(pa.h, pta.h) <= Math.min(pb.h, ptb.h)) return null;
          if (Math.max(pb.h, ptb.h) <= Math.min(pa.h, pta.h)) return null;
        }
        else {
          if (Math.max(pa.v, pta.v) <= Math.min(pb.v, ptb.v)) return null;
          if (Math.max(pb.v, ptb.v) <= Math.min(pa.v, pta.v)) return null;
        }

        // Collinear intersection may look like this (or one may be entirely
        // contained in the other or one or both endpoints may be coincident):
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

        eventPrint(a, "a ");
        eventPrint(b, "b ");

        // if one is vertical, both are close enough to vertical
        var vertical = a.vertical() || b.vertical();

        // compare bounds for left events and right events
        var hcomp = pa.hcompare(pb), htcomp = pta.hcompare(ptb);
        var lcomp = hcomp !== 0 ? hcomp : pa.vcompare(pb);
        var rcomp = htcomp !== 0 ? htcomp : pta.vcompare(ptb);
        //var lcomp = vertical ? pa.vcompare(pb) : pa.hcompare(pb);
        //var rcomp = vertical ? pta.vcompare(ptb) : pta.hcompare(ptb);

        if (printEvents) console.log("collinear", lcomp, rcomp);

        // there will be up to two split points, one on the left, another on the
        // right

        // first and second left events
        var lf = lcomp > 0 ? b : a;
        var ls = lcomp > 0 ? a : b;
        // point at which lf will be split
        var pl = lcomp > 0 ? pa : pb;

        remove(a);
        remove(b);

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
          eventPrint(lf.twin, "lr");
          eventPrint(lsplit, "ll");
        }

        if (lcomp !== 0) eventDraw(lf, o+incr*3);

        // right split left event
        var rsplit = null;
        if (rcomp !== 0) {
          eventPrint(rf, "rf");
          eventPrint(rs, "rs");
          var rst = rs.twin;
          rsplit = eventSplit(rst, pr);
          queue(rsplit);
          eventPrint(rst.twin, "rr");
          eventPrint(rsplit, "rl");
        }

        if (rcomp !== 0) eventDraw(rs.twin, o+incr*3);

        // redundant left events; invalidate one and set the other to represent
        // the depths and weights of both

        // valid event is the one above the other
        var lval = lsplit && ls === b ? lsplit : a;
        var linv = lsplit && ls === a ? lsplit : b;

        eventInvalidate(linv);

        lval.setDepthFrom(linv);
        lval.addWeightFrom(linv);

        if (lval.zeroWeight()) eventInvalidate(lval);

        // note that lf isn't inserted back; this is because the scanline is at
        // least at lval's start point, which is either at the end of lf (if
        // split) or at the start of both lf and ls, and one of them is lval

        // insert valid segment if it's contributing
        if (lval.contributing) insert(lval);

        eventPrint(lval, "lv");
        eventPrint(linv, "li");

        eventDraw(linv, o+incr*4);
        eventDraw(lval, o+incr*5);

        return ls;
      }
      // else, not collinear but intersecting at at most one point
      else if (intersection !== flags.none) {
        var coincident = MCG.Math.coincident;

        // intersection point
        var pi = null;

        // only admit intersections on one endpoint of one segment or some
        // non-endpoint on both segments
        if (intersection === flags.intermediate) pi = a.intersection(b);
        // intersection on both starting points - possibly valid if they're not
        // coincident
        else if ((intersection & flags.start) === flags.start) {
          if (!coincident(pa, pb)) {
            var t = pa.hcompare(pb) >= 0 ? a : b;
            pi = t.isParent() ? t.p : a.intersection(b);
          }
        }
        else if ((intersection & flags.end) === flags.end) {
          if (!coincident(pta, ptb)) {
            var t = pta.hcompare(ptb) > 0 ? tb : ta;
            pi = t.isParent() ? t.p : a.intersection(b);
          }
        }
        else if (intersection === flags.a0) pi = a.isParent() ? pa : a.intersection(b);
        else if (intersection === flags.a1) pi = ta.isParent() ? pta : a.intersection(b);
        else if (intersection === flags.b0) pi = b.isParent() ? pb : a.intersection(b);
        else if (intersection === flags.b1) pi = tb.isParent() ? ptb : a.intersection(b);

        if (pi && (!a.contains(pi) && !b.contains(pi))) pi = null;

        if (pi && printEvents) {
          console.log("intersection (", pi.h, pi.v, ")", intersection);

          eventPrint(a, "sa");
          eventPrint(b, "sb");
        }

        if (pi !== null) {
          eventDraw(a, o+incr*1, undefined);
          eventDraw(b, o+incr*1, undefined);

          var va = a.vertical(), vb = b.vertical();
          var ita = null, itb = null;

          var ca = coincident(pa, pi), cta = coincident(pta, pi);
          var cb = coincident(pb, pi), ctb = coincident(ptb, pi);

          // remove a and b from status so that they don't end up in the wrong
          // order
          var rma = remove(a);
          var rmb = remove(b);

          // if one event is split at the other's start, both events will end up
          // in the status structure while having only one point of vertical
          // overlap; requeue the second event so that the first half of the
          // split event can leave first
          if (ca) queue(a);
          if (cb) queue(b);

          if (!(ca || cta)) {
            ita = eventSplit(a, pi);

            // if vertical status changed for either segment, it's possible that
            // the left and right events swapped
            a = handleSwappedEventPair(a);
            ita = handleSwappedEventPair(ita);

            queue(ita);
          }
          if (!(cb || ctb)) {
            itb = eventSplit(b, pi);

            b = handleSwappedEventPair(b);
            itb = handleSwappedEventPair(itb);

            queue(itb);
          }

          if (rma && !cb) insert(a);
          if (rmb && !ca) insert(b);

          eventPrint(a, "a ");
          eventPrint(b, "b ");
          eventPrint(ita, "ia");
          eventPrint(itb, "ib");
          eventDraw(a, o+incr*2, 0x999999);
          eventDraw(b, o+incr*2, 0x999999);
          eventDraw(ita, o+incr*3, 0x666666);
          eventDraw(itb, o+incr*3, 0x666666);

        }

        return pi;
      }

      return null;
    }

    function eventInvalidate(e) {
      e.setNoncontributing();

      return remove(e);
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

      queue(ei);

      return ite;
    }

    // left event is valid if
    // 1. it is contributing,
    // 2. one side has depth 0 and the other has positive depth
    // (right events are not guaranteed to carry the correct depth information)
    function eventValid(e) {
      if (!e.isLeft) e = e.twin;

      if (!e.contributing) return false;

      var pos = e.getPosition();

      return pos & MCG.Sweep.EventPositionFlags.boundaryAB;
    }

    function statusString() {
      var iter = status.iterator();
      var r = "[ ";
      var e;

      while ((e = iter.next())!==null) {
        r += e.id + " ";
      }
      r += "]";

      return r;
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
          var f = p.p.h < e.p.h ? p : e;
          var s = p.p.h < e.p.h ? e : p;
          var ps = s.p;
          var pp = p.parent, ep = e.parent;
          console.log(
            p.linecompare(e), e.linecompare(p),
            p.vcompare(e), e.vcompare(p),
            p.scompare(e), e.scompare(p),
            MCG.Math.leftCompare(p.p, p.twin.p, e.p), MCG.Math.leftCompare(p.p, p.twin.p, e.twin.p),
            MCG.Math.leftCompare(e.p, e.twin.p, p.p), MCG.Math.leftCompare(e.p, e.twin.p, p.twin.p),
            pp.vcompare(ep), ep.vcompare(pp),
            pp.scompare(ep), ep.scompare(pp),
            f.interpolate(ps.h).v, ps.v
          );
        }
        eventPrint(e, "N ", force);
        p = e;
      }
    }

    function statusValid() {
      var iter = status.iterator(), e, p = null;
      while ((e = iter.prev()) !== null) {
        if (p) {
          var cpe = p.linecompare(e);
          var cep = e.linecompare(p);
          if (cpe === cep || cpe === 0 || cep === 0) return false;
        }
        p = e;
      }

      return true;
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
