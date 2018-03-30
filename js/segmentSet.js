function SegmentSet(axis, epsilon) {
  this.axis = axis;
  this.ah = cycleAxis(axis);
  this.av = cycleAxis(this.ah);
  this.up = makeAxisUnitVector(axis);
  this.epsilon = epsilon;

  this.segments = [];
}

SegmentSet.prototype.addSegment = function(v1, v2, normal) {
  //if (coincident(v1, v2, this.epsilon)) return;

  var segment;
  var dot = this.up.clone().cross(normal).dot(v2.clone().sub(v1));

  // make segment s.t. polygon is on the left when traversing from v1 to v2
  if (dot > 0) segment = new Segment(v1, v2);
  else segment = new Segment(v2, v1);

  this.segments.push(segment);
}

// do a union operation on all segments to eliminate segments inside polygons
SegmentSet.prototype.unify = function() {
  var axis = this.axis;
  var ah = this.ah;
  var av = this.av;
  var epsilon = this.epsilon;

  var segments = this.segments;
  var ns = segments.length;

  // priority queue storing events from left to right
  var sweepEvents = new PriorityQueue({ comparator: pqComparator });
  var so = 1;
  for (var s = 0; s < ns; s++) {
    addSegmentEvents(segments[s]);
    //debug.line(segments[s].v1, segments[s].v2, 1, false, so += 0.5, axis);
  }

  // structure storing the sweep line status
  var status = new RBTree(rbtComparator);

  var o = 0.2;
  while (sweepEvents.length > 0) {
    var event = sweepEvents.dequeue();

    //debug.point(event.v, o, this.axis);

    var vo = event.v.clone();
    vo[axis] += o;
    //debug.line(vo, event.v.clone().add(event.twin.v.clone().sub(event.v).setLength(0.5)));
    //console.log(event.slope);

    if (event.isLeft) {
      if (!event.contributing) continue;

      status.insert(event);

      // get iterator to event and then get adjacent events
      var it = status.findIter(event);
      var down = it.prev();
      it.next(); // wind iterator back to its original position
      var up = it.next();

      if (equal(event.v.x, 4, epsilon)) {

      }

      event.setDepth(down);

      handleEventIntersection(event, down);
      handleEventIntersection(event, up);
    }
    else {
      var te = event.twin;
      status.remove(te);

      if (eventValid(te)) debug.line(event.v, te.v, 1, false, 0.1, axis);
    }
    o += 0.1;
  }

  debug.lines();

  // primary sorting on horizontal coordinate (x if up axis is z)
  // secondary sorting on vertical coordinate (y if up axis is z)
  // tertiary sorting on left/right (right goes first so that, given two
  //    segments sharing an endpoint but with no vertical overlap, the left
  //    segment leaves the sweep status structure before the next goes in)
  // quaternary sorting on slope (increasing)
  function pqComparator(a, b) {
    if (a === b) return 0;

    var va = a.v, vb = b.v;

    var vah = va[ah], vbh = vb[ah];
    var hcomp = compare(vah, vbh, epsilon);

    if (hcomp !== 0) return hcomp;
    else {
      var vav = va[av], vbv = vb[av];
      var vcomp = compare(vav, vbv, epsilon);

      if (vcomp !== 0) return vcomp;
      else {
        if (!a.isLeft && b.isLeft) return -1;
        else if (a.isLeft && !b.isLeft) return 1;
        else {
          var as = a.slope, bs = b.slope;
          return compare(as, bs, epsilon);
        }
      }
    }
  }

  // primary sorting on vertical coordinate (y if up axis is z)
  // secondary sorting on slope
  // tertiary sorting on horizontal coordinate (x if up axis is z)
  function rbtComparator(a, b) {
    if (a === b) return 0;

    var vcomp = vcompare(a, b);

    if (vcomp !== 0) return vcomp;
    else {
      var as = a.slope, bs = b.slope;
      var scomp = compare(as, bs, epsilon);

      if (scomp !== 0) return scomp;
      else {
        return compare(a.v[ah], b.v[ah], epsilon);
        //var vatv = a.twin.v[av], vbtv = b.twin.v[av];
        //return compare(vatv, vbtv, epsilon);
      }
    }
  }

  // return vertical axis comparison for two left events
  function vcompare(a, b) {
    // sorting by initial vertical coordinates doesn't work because the segments
    // will not generally have vertical overlap there, so find the first
    // horizontal coordinate at which they will overlap
    var p = Math.max(a.v[ah], b.v[ah]);

    return compare(a.vath(p, ah, av), b.vath(p, ah, av), epsilon);
  }

  function eventsCollinear(a, b) {
    return equal(a.slope, b.slope, epsilon) && collinear(a.v, a.twin.v, b.v, axis, epsilon);
  }

  function addSegmentEvents(segment) {
    var v1 = segment.v1, v2 = segment.v2;

    // make events
    var event1 = new SweepEvent(v1);
    var event2 = new SweepEvent(v2);

    // link events to each other
    event1.twin = event2;
    event2.twin = event1;

    var vertical = v1[ah] === v2[ah];
    var dir = vertical ? (v1[av] < v2[av]) : (v1[ah] < v2[ah]);

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
    event1.weight = event2.weight = dir ? 1 : -1;
    event1.isLeft = dir;
    event2.isLeft = !event1.isLeft;

    // set slopes (infinite for vertical)
    var slope = vertical ? Infinity : (v2[av] - v1[av]) / (v2[ah] - v1[ah]);

    event1.slope = slope;
    event2.slope = slope;

    sweepEvents.queue(event1);
    sweepEvents.queue(event2);
  }

  // handle possible intersection between two left events
  function handleEventIntersection(a, b) {
    if (a === null || b === null) return;

    // if events are collinear, intersection is some range of points
    if (eventsCollinear(a, b)) {
      console.log(a.depthAbove, a.depthBelow);
      console.log(b.depthAbove, b.depthBelow);
      //debug.point(a.v, 0.5, axis);
      //debug.point(b.v, 1.0, axis);

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

      // leftmost left event and vertex at which it will be split
      var el = null, vl = null;
      if (lcomp !== 0) {
        el = lcomp < 0 ? a : b;
        vl = lcomp < 0 ? vb : va;
      }

      // rightmost right event and vertex at which it will be split
      var er = null, vr = null;
      if (rcomp !== 0) {
        er = rcomp < 0 ? tb : ta;
        vr = rcomp < 0 ? vta : vtb;
      }

      var els = null;
      if (lcomp !== 0) els = eventSplit(el, vl);

      var ers = null;
      if (rcomp !== 0) ers = eventSplit(er.twin, vr);

      var l0, l1;
      if (lcomp === 0) {
        l0 = a;
        l1 = b;
      }
      else {
        l0 = el === b ? a : b;
        l1 = els;
      }

      l1.invalidate();
      l0.weight = l0.weight + l1.weight;
      if (l0.weight === 0) l0.invalidate();
      console.log(l0);

      //console.log(l0, l1);

      /*// establish the order of the four endpoints (left first/second, etc.)
      var lf = lcomp > 0 ? b : a;
      var ls = lcomp > 0 ? a : b;
      var rf = rcomp > 0 ? tb : ta;
      var rs = rcomp > 0 ? ta : tb;

      // left events created by splitting the starting left event
      var l = null, r = null;

      // if endpoints not coincident, do a split
      if (lcomp !== 0) l = eventSplit(lf, ls.v);
      if (rcomp !== 0) r = eventSplit(rs.twin, rf.v);

      // between ls and rf is a pair of duplicate events: invalidate one and
      // give the other their combined weights

      // duplicate left events
      var l0, l1;

      // if coincident, no split and both left events are a and b
      if (lcomp === 0) {
        l0 = a;
        l1 = b;
      }
      // if not coincident, so one is a starting event and the other was formed
      // in the split
      else {
        l0 = (ls === a) ? a : l;
        l1 = (ls === b) ? b : l;
      }

      l0.invalidate();
      l1.weight = l0.weight + l1.weight;
      if (l1.weight === 0) l1.invalidate();*/
    }
    // else, events may intersect at one point
    else {
      var vi = computeEventIntersection(a, b);

      if (vi !== null) {
        eventSplit(a, vi);
        eventSplit(b, vi);
      }
    }
  }

  function computeEventIntersection(a, b) {
    if (a.endpointsCoincident(b, epsilon)) return null;

    return segmentSegmentIntersectionE(a.v, a.twin.v, b.v, b.twin.v, axis, epsilon);
  }

  // given the left endpoint e of an event pair, split it at vertex vi
  // returns newly created left event
  function eventSplit(e, vi) {
    var te = e.twin;

    // don't split if intersection point is on the end of the segment
    if (coincident(te.v, vi, epsilon)) return null;

    // events left and right of intersection point
    var ei = te.clone(vi);
    var ite = e.clone(vi);

    e.twin = ei;
    te.twin = ite;

    sweepEvents.queue(ei);
    sweepEvents.queue(ite);

    return ite;
  }

  function eventValid(e) {
    if (!e.contributing) return false;

    if (e.depthBelow === 0 && e.depthAbove > 0) return true;
    if (e.depthBelow > 0 && e.depthAbove === 0) return true;

    return false;
  }
}

function Segment(v1, v2) {
  this.v1 = v1;
  this.v2 = v2;
}

function SweepEvent(v) {
  this.v = v;

  this.depthBelow = 0;
  this.depthAbove = 0;

  this.twin = null;
  this.isLeft = false;
  this.slope = 0;
  this.weight = 0;

  this.contributing = true;
}

SweepEvent.prototype.vertical = function() {
  return Math.abs(this.slope) === Infinity;
}

// for a segment's left event, given position h on the horizontal axis,
// calculate its vertical axis position at h
SweepEvent.prototype.vath = function(h, ah, av) {
  var v = this.v;

  if (this.vertical()) return v[av];
  else return v[av] + this.slope * (h - v[ah]);
}

SweepEvent.prototype.setDepth = function(eventBelow) {
  var depthBelow = eventBelow !== null ? eventBelow.depthAbove : 0;

  this.depthBelow = depthBelow;
  this.depthAbove = depthBelow + this.weight;
}

SweepEvent.prototype.endpointsCoincident = function(other, epsilon) {
  if (coincident(this.v, other.v, epsilon)) return true;
  if (coincident(this.twin.v, other.twin.v, epsilon)) return true;

  return false;
}

SweepEvent.prototype.clone = function(v) {
  var e = new this.constructor();

  // copy properties and set v
  Object.assign(e, this);
  e.v = v;

  e.contributing = this.contributing;

  return e;
}

SweepEvent.prototype.invalidate = function() {
  this.contributing = false;
  this.twin.contributing = false;
}
