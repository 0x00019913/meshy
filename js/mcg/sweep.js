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

    var o = 0.0;
    var ct = 0, lim = dbg ? 30000 : 100000;
    while (events.length > 0) {
      if (ct++ > lim) {
        if (!dbg) throw "exceeded event limit " + lim;
        console.log("exceeded event limit " + lim);
        break;
      }

      var ev = dequeue();

      updateFront(ev);

      //printEvents = dbg && ct > 3340 && ct < 3360;
      //printEvents = dbg && inRange(ev.p.h, 1.3*p, 1.37*p) && inRange(ev.p.v, -5.43*p, -5.2*p);
      //printEvents = dbg && inRange(ev.p.h, 6.0*p, 7.1*p) && inRange(ev.p.v, -1.0*p, -0.5*p);
      //printEvents = dbg && inRange(ct, 1202-4, 1202+4);
      printEvents = dbg && inRange(ct, 1000, 1087);
      drawEvents = false;
      incr = 0.0005;

      //if (ct >= 18840 && ct <= 18855) printEvents = true;

      //if (dbg) debug.point(ev.p.toVector3(THREE.Vector3, srcA.context), 1.00005, axis);
      //if (dbg && ev.id===21038) debug.point(ev.p.toVector3(THREE.Vector3, srcA.context), 1.000025, axis);

      if (ev.isLeft) {
        if (!ev.contributing) continue;

        ev.setT(ct);

        var ins = insert(ev);

        var [up, dn] = eventGetAdjacent(ev);

        ev.setDepthFromBelow(dn);

        eventPrint(ev);

        //if (ct === 3) statusPrint(ev.p.h);

        if (dn) eventPrint(dn, "dn");
        if (up) eventPrint(up, "up");

        handleEventIntersection(ev, dn);
        handleEventIntersection(up, ev);

        eventDraw(ev, o+incr, 0x999999, printEvents);
        if (printEvents) o += incr;

        //depthValidate();
      }
      else {
        var tev = ev.twin;

        if (!tev.contributing) continue;

        eventPrint(ev);
        if (ev.id === 21076) {
          //if (tev.contributing) statusPrint(ev.p.h);
          //statusDraw(ev, 10, 9.995, true);
        }

        //if (tev.contributing) statusPrint(ev.p.h);

        var up = null, dn = null;

        // removing an event causes its two adjacent events to become adjacent
        // to each other, so they may intersect
        [up, dn] = eventGetAdjacent(tev);
        remove(tev);

        // handle possible intersection
        handleEventIntersection(up, dn);

        handleRightEvent(ev);

        /*// if intersection between adjacent events happens earlier in time
        // (special case that can occur when points snap to the grid), return
        // the current event and its twin to the queue and reprocess them to
        // maintain correct depth
        if (false && pi && pi.h < ev.p.h) {
          if (printEvents) console.log("removal created past event");
          queue(tev);
          queue(ev);
        }
        // else, just handle the right event
        else {
          handleRightEvent(ev);
        }*/

        eventDraw(ev, o);
      }

      statusPrintShort();

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
          statusPrint(undefined, undefined, undefined, true);
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

    /*function depthCorrect(e) {
      var iter = status.findIter(e);
      var c, p = e;

      while ((c = iter.next()) !== null) {
        if (c.seqcompare(e) !== -1) {
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

      var tc = e.seqcompare(front);

      if (tc === 1) front = e;
      else depthCorrect(e);
    }*/

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

        pi = b.interpolate(pi.h + 1);

        ca = coincident(pi, pa), cta = coincident(pi, pta);
        cb = coincident(pi, pb), ctb = coincident(pi, ptb);

        if (front.hvcomparept(pi) > 0) {
          console.log("intersection in past", intersection);
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
        remove(a);
        remove(b);

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

        // a and b may have become coincident; merge them and return
        if (coincident(a.p, b.p) && coincident(a.twin.p, b.twin.p)) {
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
        // else, if b is vertical and a split it, requeue a to correct depth
        else if (ca) queue(a);
        // else, just insert it back
        else insert(a);

        // likewise for b
        if (front.hvcompare(tb) >= 0) handleRightEvent(tb);
        else if (cb) queue(b);
        else insert(b);
      }

      return pi;

      // if collinear, need to do special handling
      if (intersection === flags.collinear) {
        // verify that the event pairs actually overlap
        /*if (a.horizontal() || b.horizontal()) {
          if (Math.max(pa.h, pta.h) <= Math.min(pb.h, ptb.h)) return null;
          if (Math.max(pb.h, ptb.h) <= Math.min(pa.h, pta.h)) return null;
        }
        else {
          if (Math.max(pa.v, pta.v) <= Math.min(pb.v, ptb.v)) return null;
          if (Math.max(pb.v, ptb.v) <= Math.min(pa.v, pta.v)) return null;
        }*/

        // dot product should be positive for events to be considered collinear
        if (pa.vectorTo(pta).dot(pb.vectorTo(pb)) <= 0) return null;

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
        var lcomp = a.hvcompare(b), rcomp = ta.hvcompare(tb);
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
          //eventPrint(lf, "lf");
          //eventPrint(ls, "ls");
          eventPrint(lf.twin, "lr");
          eventPrint(lsplit, "ll");
        }

        if (lcomp !== 0) eventDraw(lf, o+incr*3);

        // right split left event
        var rsplit = null;
        if (rcomp !== 0) {
          //eventPrint(rf, "rf");
          //eventPrint(rs, "rs");
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

        return ls.p;
      }
      // else, not collinear but intersecting at at most one point
      else if (intersection !== flags.none) {
        // intersection point
        var pi = null;
        // true if intersection is on a single endpoint
        var ei = false;

        // only admit intersections on one endpoint of one segment or some
        // non-endpoint on both segments
        if (intersection === flags.intermediate) pi = a.intersection(b);
        // intersection on both start points - possibly valid if they're not
        // coincident
        else if ((intersection & flags.a0b0) === flags.a0b0) {
          var hvcomp = a.hvcompare(b);
          if (hvcomp !== 0) pi = hvcomp > 0 ? pa : pb;
        }
        else if ((intersection & flags.a1b1) === flags.a1b1) {
          var hvcomp = ta.hvcompare(tb);
          if (hvcomp !== 0) pi = hvcomp > 0 ? ptb : pta;
        }
        // intersection at a single start/end point
        // for a
        else if (intersection & flags.a) {
          if (intersection === flags.a0) pi = pa;
          else if (intersection === flags.a1) pi = pta;

          // an endpoint of segment a splits segment b; if the endpoint is
          // strictly outside the other event, set the intersection to their
          // proper intersection
          // this fixes the problem of a vertical segment split by an endpoint
          // 1 unit behind it, which causes it to "buckle" backward, like so:
          //     |            /
          //     |           /
          // a -----  ->  a ----
          //     |           \
          //     b            b
          // in this instance, b's bottom (left) event now connects to a right
          // event that is to its left, which triggers the swap handler, which
          // makes the sequence of events messy
          /*if (pi.h < pb.h) pi = a.intersection(b);
          else if (pi.h > ptb.h) pi = a.intersection(b);
          else if (pi.v < Math.min(pb.v, ptb.v)) pi = a.intersection(b);
          else if (pi.v > Math.max(pb.v, ptb.v)) pi = a.intersection(b);*/
        }
        // for b
        else if (intersection & flags.b) {
          if (intersection === flags.b0) pi = pb;
          else if (intersection === flags.b1) pi = ptb;

          /*if (pi.h < pa.h) pi = a.intersection(b);
          else if (pi.h > pta.h) pi = a.intersection(b);
          else if (pi.v < Math.min(pa.v, pta.v)) pi = a.intersection(b);
          else if (pi.v > Math.max(pa.v, pta.v)) pi = a.intersection(b);*/
        }

        if (pi && (!a.contains(pi) && !b.contains(pi))) pi = null;

        if (a.horizontal() || b.horizontal()) {
          if (Math.max(pa.h, pta.h) < Math.min(pb.h, ptb.h)) pi = null;
          if (Math.max(pb.h, ptb.h) < Math.min(pa.h, pta.h)) pi = null;
        }
        else {
          if (Math.max(pa.v, pta.v) < Math.min(pb.v, ptb.v)) pi = null;
          if (Math.max(pb.v, ptb.v) < Math.min(pa.v, pta.v)) pi = null;
        }

        if (pi && printEvents) {
          console.log("intersection (", pi.h, pi.v, ")", intersection);

          eventPrint(a, "sa");
          eventPrint(b, "sb");
        }

        if (pi !== null) {
          if (ev && pi.h < ev.p.h) { // todo: remove?
            //return null;
          }
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
          //if (ca) queue(a);
          //if (cb) queue(b);

          var a0 = a, b0 = b;

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

          if (!ca) insert(a);
          else queue(a);

          if (!cb) insert(b);
          else queue(b);
          /*if (anew !== a || ca) queue(anew);
          else if (rma) insert(a);

          if (bnew !== b || cb) queue(bnew);
          else if (rmb) insert(b);*/

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

    function statusPrint(h, vmin, vmax, force) {
      if (!printEvents && !force) return;

      if (vmin === undefined) vmin = -Infinity;
      if (vmax === undefined) vmax = Infinity;

      var iter = status.iterator(), e, p = null;
      while ((e = iter.prev()) !== null) {
        if (e.p.v < vmin || e.p.v > vmax) continue;
        if (p) {
          var f = p.p.h < e.p.h ? p : e;
          var s = p.p.h < e.p.h ? e : p;
          var ps = s.p;
          var lc = MCG.Math.leftCompareStrict;
          console.log(
            p.linecompare(e), e.linecompare(p),
            p.vcompare(e), e.vcompare(p),
            p.scompare(e), e.scompare(p),
            lc(p.p, p.twin.p, e.twin.p), lc(e.p, e.twin.p, p.twin.p),
            lc(p.p, p.twin.p, e.p), lc(e.p, e.twin.p, p.p),
            e.intersects(p),
            e.interpolate(h!==undefined ? h : p.p.h).v, e.interpolate(p.p.h).v
          );
        }
        eventPrint(e, ">N", force);
        p = e;
      }
    }

    function statusDraw(ev, factor, d, force) {
      if (!drawEvents && !force) return;

      var iter = status.iterator(), e;
      var vmin = Infinity, vmax = -Infinity;
      var ctx = Object.assign({}, context);
      ctx.d = d;
      while ((e = iter.next()) !== null) {
        var ep = e.p, etp = e.twin.p;
        vmin = Math.min(vmin, ep.v);
        vmax = Math.max(vmax, ep.v);
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
