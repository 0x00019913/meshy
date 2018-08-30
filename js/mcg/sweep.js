Object.assign(MCG.Sweep, (function() {

  var printEvents = false;
  var drawEvents = false;
  var incr = 0;

  function sweep(operation, srcA, srcB) {
    if (!srcA) return null;

    var context = srcA.context;

    var axis = context.axis;
    var ah = context.ah;
    var av = context.av;
    var p = context.p;

    // the farthest event that has occurred (with respect to the scanline) -
    // used to catch event pairs that exist entirely in the past
    var front = null;

    var efactory = new MCG.Sweep.SweepEventFactory(context);

    var store = operation.initStore(context, srcA, srcB);
    var dbg = store.dbg;

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

    var o = 0.5;
    var ct = 0, lim = dbg ? 50000 : 100000;
    while (events.length > 0) {
      if (ct++ > lim) {
        if (!dbg) throw "exceeded event limit " + lim;
        console.log("exceeded event limit " + lim);
        break;
      }

      var ev = dequeue();

      updateFront(ev);

      //printEvents = dbg && inRange(ev.p.h, 1.3*p, 1.37*p) && inRange(ev.p.v, -5.43*p, -5.2*p);
      //printEvents = dbg && inRange(ev.p.h, 6.0*p, 7.1*p) && inRange(ev.p.v, -1.0*p, -0.5*p);
      //printEvents = dbg && inRange(ev.p.h, 9.28*p, 9.30*p);
      //printEvents = dbg && inRange(ct, 31117, 31211) && ((ev.twin.p.v-ev.p.v)*(ev.isLeft?1:-1) > 0);
      printEvents = dbg && ev.p.v < -6.7*p && ev.p.h > -1.0*p && ev.p.h < 0.5*p;
      drawEvents = false;
      incr = 0.00001;

      //if (dbg) debug.point(ev.p.toVector3(THREE.Vector3, srcA.context), 1.00005, axis);
      //if (dbg && ev.id===21038) debug.point(ev.p.toVector3(THREE.Vector3, srcA.context), 1.000025, axis);

      if (ev.isLeft) {
        if (!ev.contributing) continue;

        ev.setT(ct);

        var ins = insert(ev);

        var [up, dn] = eventGetAdjacent(ev);
        if (printEvents && up && dn) console.log(up.intersects(dn));

        // if the up event has the same starting point, it's possible that it
        // was initially below the current event in slope but then became above
        // in slope due to an intersection, so now the current is is below when
        // it should've been above according to the initial placement in the
        // queue; requeue both and continue
        if (up && ev.hvcompare(up) === 0) {
          requeue(up);
          requeue(ev);

          continue;
        }

        ev.setDepthFromBelow(dn);

        eventPrint(ev);

        if (dn) eventPrint(dn, "dn");
        if (up) eventPrint(up, "up");

        handleEventIntersection(ev, dn);
        handleEventIntersection(up, ev);

        //eventDraw(ev, o+incr, 0x999999, printEvents);
        if (printEvents) o += incr;

        //depthValidate();
      }
      else {
        var tev = ev.twin;

        if (!tev.contributing) continue;

        handleRightEvent(ev);

        var up = null, dn = null;

        // removing an event causes its two adjacent events to become adjacent
        // to each other, so they may intersect
        [up, dn] = eventGetAdjacent(tev);

        if (ev.id==26020) {
          eventDraw(up, 0.50152, 0xff9999, printEvents);
          eventDraw(ev, 0.50151, 0x99ff99, printEvents);
          eventDraw(dn, 0.50150, 0x9999ff, printEvents);
        }
        //debug.point(new MCG.Vector(context, 928611, 3256127).toVector3(THREE.Vector3), 0.50148, context.axis);
        if (up) eventPrint(up, "uR");
        eventPrint(ev);
        if (dn) eventPrint(dn, "dR");
        remove(tev);
        eventPairComparisonPrint(up, dn);

        // handle possible intersection
        handleEventIntersection(up, dn);

        eventDraw(ev, o);
      }

      if (ct >= 1121) statusPrint();
      else statusPrintShort();

      if (drawEvents) o += incr*10;
    }

    //debug.lines();

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
    // potentially occur when splitting events), recreate the event pair in the
    // correct order
    function handleSwappedEventPair(ev) {
      var tev = ev.twin;

      if (ev.hvcompare(tev) < 0) return ev;

      eventInvalidate(ev);

      var el = createPointPair(tev.p, ev.p);
      if (el === null) return null;

      // assign weight and depth
      el.setWeightFrom(ev, true);
      el.depthBelowA = ev.depthBelowA + ev.weightA;
      el.depthBelowB = ev.depthBelowB + ev.weightB;

      if (printEvents) {
        console.log("handled swapped pair");
      }

      return el;
    }

    function eventGetAdjacent(ev) {
      var it = status.findIter(ev);

      // if event not found for some reason, check if it's actually present;
      // this is an error
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
          statusPrint(undefined, undefined, true);
          eventPrint(ev, "ev", true);
          console.log(store);
          debug.point(ev.p.toVector3(THREE.Vector3, context), 0.25, context.axis);
          debug.point(ev.twin.p.toVector3(THREE.Vector3, context), 0.25, context.axis);
          debug.lines();
          throw "failed to find event in status " + ev.id + " " + ev.twin.id;
          //console.log("failed to find event in status", ev.id, ev.twin.id);
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
      if (printEvents) console.log("queue", e.id);
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
      if (!e.contributing) return;

      if (printEvents) console.log("insert", e.id);

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
      eventInvalidate(te);
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

    function updateFront(ev) {
      if (front === null || ev.hvcompare(front) > 0) front = ev;
    }

    // if two segments are exactly coincident, merge b into a and invalidate b
    function mergeEvents(a, b) {
      a.setDepthFrom(b);
      a.addWeightFrom(b);

      eventInvalidate(b);

      // todo: remove
      if (printEvents) {
        console.log("merge events");
      }

      if (a.zeroWeight()) {
        eventInvalidate(a);
        if (printEvents) {
          eventPrint(a, "ma");
          eventPrint(b, "mb");
        }
        return null;
      }
      else {
        if (printEvents) {
          eventPrint(a, "ma");
          eventPrint(b, "mb");
        }
        return a;
      }
    }

    // handle a possible intersection between a pair of left events;
    // event a is above event b
    function handleEventIntersection(a, b) {
      if (a === null || b === null) return null;
      if (!a.contributing || !b.contributing) return null;

      var ta = a.twin, tb = b.twin;
      var coincident = MCG.Math.coincident;

      // h-v comparison of start points and end points - 0 if coincident
      var hvcomp = a.hvcompare(b);
      var thvcomp = ta.hvcompare(tb);

      // if two segments are exactly coincident, merge b into a and invalidate b
      if (hvcomp === 0 && thvcomp === 0) {
        remove(a);
        remove(b);

        a = mergeEvents(a, b);
        if (a !== null) {
          insert(a);
          return a.p;
        }
        else return null;
      }

      var flags = MCG.Math.IntersectionFlags;
      var intersection = a.intersects(b);

      if (intersection === flags.none) return null;

      var pa = a.p, pb = b.p;
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

      // if events are not horizontal and have no vertical overlap, return
      if (!a.horizontal() && !b.horizontal()) {
        if (Math.max(pa.v, pta.v) < Math.min(pb.v, ptb.v)) return null;
        if (Math.max(pb.v, ptb.v) < Math.min(pa.v, pta.v)) return null;
      }

      // point of intersection
      var pi = null;

      // if intersection is somewhere along both segments, calculate it
      if (intersection === flags.intermediate) {
        pi = a.intersection(b);
      }
      // else, if starting points aren't coincident and intersection includes
      // one or both of them, set intersection point to one of them
      else if ((hvcomp !== 0) && (intersection & flags.a0b0)) {
        var ia0 = intersection & flags.a0;
        var ib0 = intersection & flags.b0;

        // if potential intersection on either start point, pick the later one
        if (ia0 && ib0) pi = hvcomp > 0 ? pa : pb;
        else if (ia0) pi = pa;
        else if (ib0) pi = pb;
      }
      // else, if ending points aren't coincident and intersection includes
      // one or both of them, set intersection point to one of them
      else if ((thvcomp !== 0) && (intersection & flags.a1b1)) {
        var ia1 = intersection & flags.a1;
        var ib1 = intersection & flags.b1;

        // if potential intersection on either end point, pick the earlier one
        if (ia1 && ib1) pi = thvcomp > 0 ? ptb : pta;
        else if (ia1) pi = pta;
        else if (ib1) pi = ptb;
      }

      // return if no intersection
      if (pi === null) return null;

      // coincidence of intersection point with endpoints
      var ca = coincident(pi, pa), cta = coincident(pi, pta);
      var cb = coincident(pi, pb), ctb = coincident(pi, ptb);

      // if intersection point is earlier than the front, need to shift it so
      // that it's at least in the present
      var fphvcomp = front.hvcomparept(pi);
      if (fphvcomp > 0) {
        var h = Math.max(pi.h, front.p.h) + 1;
        var t = b.vertical() ? a : b;
        if (printEvents) {
          console.log("adjust intersection", "(", pi.h, pi.v, ") -> (", t.interpolate(h).h, t.interpolate(h).v, ") front (", front.p.h, front.p.v, ")");
        }

        pi = t.interpolate(h);

        //if (pi.h > t.twin.p.h) pi = t.twin.p;

        ca = coincident(pi, pa), cta = coincident(pi, pta);
        cb = coincident(pi, pb), ctb = coincident(pi, ptb);

        if (front.hvcomparept(pi) > 0) {
          console.log("intersection in past", intersection, store);
          eventPrint(a, "a ", true);
          eventPrint(b, "b ", true);
          console.log(a.p.h-pi.h, b.p.h-pi.h, pi);
          debug.point(pa.toVector3(THREE.Vector3, context), 0.15, context.axis);
          debug.point(pb.toVector3(THREE.Vector3, context), 0.20, context.axis);
          debug.point(pi.toVector3(THREE.Vector3, context), 0.25, context.axis);
        }
      }

      // if intersection point is established, split one or both segments
      if (pi !== null) {
        // todo: remove
        if (printEvents) {
          console.log("intersection (", pi.h, pi.v, ")", intersection);

          eventPrint(a, "sa");
          eventPrint(b, "sb");
        }

        // remove both events - due to numeric imprecision, their place in the
        // status structure may change after splitting
        var rma = remove(a);
        var rmb = remove(b);

        // new events formed by a split
        var ita = null, itb = null;

        // if intersection point is not on either endpoint of a, split a
        if (!(ca || cta)) {
          ita = eventSplit(a, pi);

          a = handleSwappedEventPair(a);
          ita = handleSwappedEventPair(ita);

          queue(ita);
          queue(ita.twin);
        }

        // likewise for b
        if (!(cb || ctb)) {
          itb = eventSplit(b, pi);

          b = handleSwappedEventPair(b);
          itb = handleSwappedEventPair(itb);

          queue(itb);
          queue(itb.twin);
        }

        // todo: remove
        eventPrint(a, "a ");
        eventPrint(b, "b ");
        eventPrint(ita, "ia");
        eventPrint(itb, "ib");

        // a and b may have become coincident; if so, merge them and return
        if (a.segmentsCoincident(b)) {
          a = mergeEvents(a, b);

          if (a !== null) {
            insert(a);
            return a.p;
          }
          else return null;
        }

        ta = a.twin;
        tb = b.twin;

        // if a's twin is before or at the front, a is entirely in the past, so
        // handle its right event immediately
        if (front.hvcompare(ta) >= 0) handleRightEvent(ta);
        // else, if a split b, it may not have the correct depth, so requeue it
        else if (ca) queue(a);
        // else, just insert it back
        else if (rma) insert(a);

        // likewise for b
        if (front.hvcompare(tb) >= 0) handleRightEvent(tb);
        else if (cb) queue(b);
        else if (rmb) insert(b);
      }

      return pi;
    }

    function eventInvalidate(e) {
      e.setNoncontributing();
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

    function statusPrint(vmin, vmax, force) {
      if (!printEvents && !force) return;

      if (vmin === undefined) vmin = -Infinity;
      if (vmax === undefined) vmax = Infinity;

      var iter = status.iterator(), e, p = null;
      while ((e = iter.prev()) !== null) {
        if (e.p.v < vmin || e.p.v > vmax) continue;
        if (p) eventPairComparisonPrint(p, e, force);
        eventPrint(e, ">N", force);
        p = e;
      }
    }

    function eventPairComparisonPrint(ep, ee, force) {
      if (!printEvents && !force) return;

      var lc = MCG.Math.leftCompare;
      if (printEvents && ep && ee) {
        var ef = ep.p.h < ee.p.h ? ep : ee;
        var es = ep.p.h < ee.p.h ? ee : ep;
        console.log(
          ep.linecompare(ee), ee.linecompare(ep),
          ep.vlinecompare(ee), ee.vlinecompare(ep),
          ep.scompare(ee), ee.scompare(ep),
          lc(ep.p, ep.twin.p, ee.twin.p), lc(ee.p, ee.twin.p, ep.twin.p),
          lc(ep.p, ep.twin.p, ee.p), lc(ee.p, ee.twin.p, ep.p),
          ee.intersects(ep),
          ef.interpolate(es.p.h).h, ef.interpolate(es.p.h).v
        );
      }
    }

    function statusDraw(ev, factor, d, force) {
      if (!drawEvents && !force) return;

      var iter = status.iterator(), e;
      var vmin = Infinity, vmax = -Infinity;
      var ctx = Object.assign({}, context);
      ctx.d += d;
      while ((e = iter.next()) !== null) {
        var ep = e.p, etp = e.twin.p;
        vmin = Math.min(vmin, ep.v, etp.v);
        vmax = Math.max(vmax, ep.v, etp.v);
        var epc = ep.clone().multiplyScalar(factor);
        var etpc = etp.clone().multiplyScalar(factor);
        debug.line(epc.toVector3(THREE.Vector3, ctx), etpc.toVector3(THREE.Vector3, ctx), 1, false, 0, ctx.axis);
      }

      var top = ev.p.clone().setV(vmax).multiplyScalar(factor);
      var bot = ev.p.clone().setV(vmin).multiplyScalar(factor);
      debug.line(top.toVector3(THREE.Vector3, ctx), bot.toVector3(THREE.Vector3, ctx), 1, false, 0, ctx.axis);
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
      debug.oneline(e.p.toVector3(THREE.Vector3, context), e.twin.p.toVector3(THREE.Vector3, context), offset, axis, color);
    }

    function eventColor(e) {
      if (!e.isLeft) {
        if (eventValid(e.twin)) return 0x66ff66;
        else return 0xff0000;
      }
      else if (e.contributing) return 0xff6666;
      else return 0x6666ff;
    }
  }

  return {
    sweep: sweep
  };

})());
