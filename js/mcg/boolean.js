MCG.Boolean = (function() {

  var Boolean = {
    union: union
  };

  function union(a, attributes) {
    return sweep(a, attributes);
  }


  function sweep(src, attributes) {
    var axis = attributes.axis;
    var ah = attributes.ah;
    var av = attributes.av;
    var p = attributes.p;

    var efactory = new SweepEventFactory(attributes);

    var drawEvents = false;
    var printEvents = true;
    var drawSourceSegments = false;
    var incrHeight = false;

    // priority queue storing events from left to right
    var events = new PriorityQueue({
      comparator: pqComparator
    });

    if (src.type === MCG.GeometryTypes.segmentSet) {
      var segments = src.segments;
      var ns = segments.length;

      for (var s = 0; s < ns; s++) {
        addSegmentEvents(segments[s]);
        var ss = segments[s];
        if (drawSourceSegments) debug.line(ss.p1.src, ss.p2.src, 0.1, axis);
      }
    }

    // structure storing the sweep line status
    var status = new RBTree(rbtComparator);

    var o = 1.0;
    var prev = null;
    while (events.length > 0) {
      var event = events.dequeue();

      if (event.isLeft) {
        debug.line(event.source, event.twin.source, 1, false, 0.5, axis);
      }
      continue;

      if (event.isLeft) {
        status.insert(event);

        if (event.outOfOrder) queue(event.twin);

        var it = null;

        it = status.findIter(event);
        var dn = it.prev();
        it = status.findIter(event);
        var up = it.next();

        event.setDepthFromBelow(dn);

        eventPrint(event);
        eventDraw(event, o, 0x999999);

        if (dn !== null) {
          if (eventsCollinear(event, dn)) {
            handleEventOverlap(event, dn);
          }
          else {
            handleEventIntersection(event, dn);
          }
        }

        if (up !== null) {
          if (eventsCollinear(event, up)) {
            handleEventOverlap(event, up);
          }
          else {
            handleEventIntersection(event, up);
          }
        }
      }
      else {
        var te = event.twin;

        if (te.contributing) {
          var res = status.remove(te);
          if (!res) {
            te.outOfOrder = true;

            var r = event, l = event.twin;
            console.log(r.id, l.id);
          }
        }

        if (eventValid(te)) {
          debug.line(event.v, te.v, 1, false, 0.1 + (incrHeight&&!drawEvents ? o/7 : 0), axis);
        }

        eventPrint(event);
        eventDraw(event, o);
      }

      statusDraw(o+0.6);
      o += 1;
    }

    debug.lines();

    // primary sorting on horizontal coordinate (x if up axis is z)
    // secondary sorting on vertical coordinate (y if up axis is z)
    // tertiary sorting on left/right (right goes first so that, given two
    //   segments sharing an endpoint but with no vertical overlap, the left
    //   segment leaves the sweep status structure before the next goes in)
    // quaternary sorting on slope (increasing)
    // quinary sorting on id
    function pqComparator(a, b) {
      if (a.id === b.id) return 0;

      var hcomp = a.h - b.h;

      if (hcomp !== 0) return hcomp;
      else {
        var vcomp = a.v - b.v;

        if (vcomp !== 0) return vcomp;
        else {
          if (!a.isLeft && b.isLeft) return -1;
          else if (a.isLeft && !b.isLeft) return 1;
          else {
            var scomp = compare(a.slope, b.slope, attributes.epsilon);

            if (scomp !== 0) return scomp;
            else {
              return a.id - b.id;
            }
          }
        }
      }
    }

    // primary sorting on vertical coordinate (y if up axis is z)
    // secondary sorting on slope
    // tertiary sorting on contributing (if events collinear, contributing events
    //   go on top)
    // quaternary sorting on id: there is no meaningful ordering for collinear
    //   segments, so at least pick a unique ordering to be consistent
    function rbtComparator(a, b) {
      if (a.id === b.id) return 0;

      var vcomp = vcompare(a, b);

      if (vcomp !== 0) return vcomp;
      else {
        var scomp = compare(a.slope, b.slope, attributes.epsilon);

        if (scomp !== 0) return scomp;
        else {
          return a.id - b.id;
        }
      }
    }

    // return vertical axis comparison for two left events
    function vcompare(a, b) {
      var avh = a.v[ah], bvh = b.v[ah];

      // sorting by initial vertical coordinates doesn't work because the segments
      // will not generally have vertical overlap there, so find the first
      // horizontal coordinate at which they will overlap
      var avv, bvv;
      if (avh > bvh) {
        avv = a.v[av];
        bvv = vinterpolate(b, avh);
      }
      else {
        avv = vinterpolate(a, bvh);
        bvv = b.v[av];
      }

      return compare(avv, bvv, epsilon);
    }

    // interpolate left event e's value at horizontal coordinate h
    function vinterpolate(e, h) {
      var v = e.v;

      if (e.vertical()) return v[av];
      else {
        var vt = e.twin.v;
        var p = (h - v[ah]) / (vt[ah] - v[ah]);
        return v[av] + p * (vt[av] - v[av]);
      }
    }

    function eventsCollinear(a, b) {
      return equal(a.slope, b.slope, epsilon) && vcompare(a, b) === 0;
    }

    function addSegmentEvents(segment) {
      var v1 = segment.v1, v2 = segment.v2;

      // make events
      var e1 = efactory.create(v1, attributes);
      var e2 = efactory.create(v2, attributes);

      // link events to each other
      e1.twin = e2;
      e2.twin = e1;

      var vertical = e1.h === e2.h;
      var dir = vertical ? (e1.v < e2.v) : (e1.h < e2.h);

      // assign flags
      // (v1 and v2 assigned s.t. poly interior is on left of v1 -> v2 edge;
      // weight is +1 if vertical line going up through v1 -> v2 edge transitions
      // from outside polygon to inside, else -1)
      // if vertical:
      //  if points up, poly interior is on left, v1 is first (left) point
      //  else, poly interior is on right, v2 is first (left) point
      // else:
      //  if points right, poly interior is up, v1 is first (left) point
      //  else, poly interior is down, v2 is first (left) point
      e1.weight = e2.weight = dir ? 1 : -1;
      e1.isLeft = dir;
      e2.isLeft = !e1.isLeft;

      // set slopes (infinite for vertical, and -Infinity is not allowed b/c
      // every verical line intersects the scanline at its lowest point)
      var slope = vertical ? Infinity : (e2.v - e1.v) / (e1.h - e1.h);

      e1.slope = slope;
      e2.slope = slope;

      queue(e1);
      queue(e2);
    }

    function queue(e) {
      events.queue(e);
    }

    // handle collinear overlap between a pair of events
    function handleEventOverlap(a, b) {
      if (a === null || b === null) return;

      if (!a.contributing || !b.contributing) {
        console.log("FOOOOO");
        return;
      }

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

      var va = a.v, vb = b.v;
      var ta = a.twin, tb = b.twin;
      var vta = ta.v, vtb = tb.v;

      // (if a is vertical, both are vertical)
      var vertical = a.vertical();

      // axis on which we'll compare bounds (vertical if segment is vertical,
      // else horizontal)
      var caxis = vertical ? av : ah;

      var lcomp = compare(va[caxis], vb[caxis], epsilon);
      var rcomp = compare(vta[caxis], vtb[caxis], epsilon);

      // there will be up to two split points, one on the left, another on the
      // right

      // first and second left events
      var lf = lcomp > 0 ? b : a;
      var ls = lcomp > 0 ? a : b;
      // vertex at which lf will be split
      var vl = lcomp > 0 ? va : vb;

      // first and second right events
      var rf = rcomp > 0 ? tb : ta;
      var rs = rcomp > 0 ? ta : tb;
      // vertex at which rs's twin will be split
      var vr = rcomp > 0 ? vtb : vta;

      // left split left event
      var lsplit = null;
      if (lcomp !== 0) {
        lsplit = eventSplit(lf, vl);
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
        rsplit = eventSplit(rst, vr);
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

      var vi = computeEventIntersection(a, b);

      if (vi !== null) {
        if (printEvents) console.log("INTERSECTION");

        eventDraw(a, o+0.1);
        eventDraw(b, o+0.1);
        // don't split if the intersection point is on the end of a segment
        var ita = eventSplit(a, vi);
        if (ita !== null) {
          queue(a.twin);
          queue(ita);
          queue(b);
        }

        var itb = eventSplit(b, vi);
        if (itb !== null) {
          queue(b.twin);
          queue(itb);
          queue(a);
        }

        eventPrint(ita, "ia");
        eventPrint(itb, "ib");
        eventDraw(a, o+0.2, 0x999999);
        eventDraw(b, o+0.2, 0x999999);
        eventDraw(ita, o+0.3);
        eventDraw(itb, o+0.3);
      }
    }

    function eventInvalidate(e) {
      e.setNoncontributing();

      status.remove(e);
    }

    function computeEventIntersection(a, b) {
      if (a.endpointsCoincident(b, epsilon)) return null;

      return segmentSegmentIntersectionE(a.v, a.twin.v, b.v, b.twin.v, axis, epsilon);
    }

    // given the left endpoint e of an event pair, split it at vertex vi
    // returns newly created left event
    function eventSplit(e, vi) {
      var te = e.twin;

      if (coincident(e.v, vi, epsilon) || coincident(te.v, vi, epsilon)) return null;

      // events left and right of intersection point
      var ei = efactory.clone(te, vi);
      var ite = efactory.clone(e, vi);

      e.twin = ei;
      te.twin = ite;

      return ite;
    }

    // left event is valid if
    // 1. it is contributing,
    // 2. one side has depth 0 and the other has positive depth
    // (right events are not guaranteed to carry the correct depth information)
    function eventValid(e) {
      if (!e.contributing) return false;

      var da = e.depthAbove;
      var db = e.depthBelow;

      return (da === 0 && db > 0) || (da > 0 && db === 0);
    }

    function verifyEvent(u, e, d) {
      var pquval = true;
      var pqdval = true;
      var stuval = true;
      var stdval = true;
      var uval = true;
      var dval = true;
      var val = true;

      if (u) {
        var ut = u.twin;
        pquval = pqComparator(u, e) < 0 && pqComparator(ut, e) > 0;
        stuval = rbtComparator(u, e) > 0;
        uval = pquval && stuval;

        if (!uval) {
          console.log("fail up", pquval, stuval);
          console.log(pqComparator(u, e), pqComparator(ut, e));
          eventPrint(e, "e ");
          eventPrint(u, "u ");
          eventPrint(ut, "ut");
        }
      }

      if (d) {
        var dt = d.twin;
        pqdval = pqComparator(d, e) < 0 && pqComparator(dt, e) > 0;
        stdval = rbtComparator(e, d) > 0;
        dval = pqdval && stdval;

        if (!dval) {
          console.log("fail down", pqdval, stdval);
          console.log(pqComparator(d, e), pqComparator(dt, e));
          eventPrint(e, "e ");
          eventPrint(d, "d ");
          eventPrint(dt, "dt");
        }
      }

      val = uval && dval;

      return val;
    }

    function eventString(e) {
      if (!e) return "null";

      var src = e.isLeft ? e : e.twin;
      var d = 7;

      var data =
        [e.isLeft ? "L " : "R ", e.id, e.twin.id,
          '(', e.v[ah].toFixed(d),
          e.v[av].toFixed(d), ')',
          '(', e.twin.v[ah].toFixed(d),
          e.twin.v[av].toFixed(d), ')',
          e.v.distanceTo(e.twin.v).toFixed(2),
          "s", src.slope.toFixed(7),
          "w", src.weight,
          "d", src.depthBelow, src.depthAbove,
          e.contributing ? "t" : "f"];
      var p =
        [1, 3, 3,
          2, d+3,
          d+3, 1,
          2, d+3,
          d+3, 1,
          5,
          2, 11,
          2, 2,
          2, 2, 2,
          1]
      var r = "";
      for (var d=0; d<data.length; d++) r += lpad(data[d], p[d]);

      if (!eventValid(e.isLeft ? e : e.twin)) r += " i";

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
      debug.oneline(e.v, e.twin.v, incr, axis, color);
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


  function SweepEvent(v, attributes) {
    this.source = v;
    if (attributes !== undefined) this.setCoords(attributes);

    this.id = -1;

    this.depthBelow = 0;
    this.depthAbove = 0;

    this.twin = null;
    this.isLeft = false;
    this.slope = 0;
    this.weight = 0;

    this.contributing = true;
  }

  SweepEvent.prototype.setCoords = function(attributes) {
    var p = attributes.p;
    var source = this.source;

    this.h = numHash(source[attributes.ah], p);
    this.v = numHash(source[attributes.av], p);
  }

  SweepEvent.prototype.vertical = function() {
    return Math.abs(this.slope) === Infinity;
  }

  SweepEvent.prototype.setDepthFromBelow = function(eventBelow) {
    var depthBelow = eventBelow !== null ? eventBelow.depthAbove : 0;

    this.depthBelow = depthBelow;
    this.depthAbove = depthBelow + this.weight;

    this.twin.depthBelow = this.depthBelow;
    this.twin.depthAbove = this.depthAbove;
  }

  SweepEvent.prototype.endpointsCoincident = function(other, epsilon) {
    if (coincident(this.v, other.v, epsilon)) return true;
    if (coincident(this.twin.v, other.twin.v, epsilon)) return true;

    return false;
  }

  SweepEvent.prototype.clone = function(v, attributes) {
    var e = new this.constructor();

    // copy properties and set source/coords
    Object.assign(e, this);
    e.source = v;
    e.setCoords(attributes);

    return e;
  }

  SweepEvent.prototype.setNoncontributing = function() {
    this.contributing = false;
    this.twin.contributing = false;
  }

  function SweepEventFactory(attributes) {
    this.id = 0;
    this.attributes = attributes;
  }

  SweepEventFactory.prototype.create = function(v) {
    var e = new SweepEvent(v, this.attributes);
    e.id = this.id++;

    return e;
  }

  SweepEventFactory.prototype.clone = function(e, v) {
    var ne = e.clone(v);
    ne.id = this.id++;

    return ne;
  }


  return Boolean;

})();
