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
  for (var s = 0; s < ns; s++) {
    addSegmentEvents(segments[s]);
  }

  // structure storing the sweep line status
  var status = new RBTree(rbtComparator);

  var o = 0;
  while (sweepEvents.length > 0) {
    var event = sweepEvents.dequeue();

    debug.point(event.v, o, this.axis);

    if (event.isLeft) {
      status.insert(event);

      // get iterator to event and then get adjacent events
      var it = status.findIter(event);
      console.log(status, it);
      var down = it.prev();
      it.next(); // wind iterator back to its original position
      var up = it.next();

      event.setDepth(down);

      var idown = eventIntersection(event, down);
      var iup = eventIntersection(event, up);

      if (idown) {
        eventSplit(event, idown);
        eventSplit(down, idown);
      }

      if (iup) {
        eventSplit(event, iup);
        eventSplit(up, iup);
      }
    }
    else {
      var te = event.twin;
      status.remove(te);

      if (eventValid(te)) debug.line(event.v, te.v);
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
  // tertiary sorting on twin event's vertical coordinate
  function rbtComparator(a, b) {
    if (a === b) return 0;

    //var va = a.v, vb = b.v;
    //var vav = va[av], vbv = vb[av];
    //var vcomp = compare(vav, vbv, epsilon);

    var vcomp = vcompare(a, b);

    if (vcomp !== 0) return vcomp;
    else {
      var as = a.slope, bs = b.slope;
      var scomp = compare(as, bs, epsilon);

      if (scomp !== 0) return scomp;
      else {
        var vatv = a.twin.v[av], vbtv = b.twin.v[av];
        return compare(vatv, vbtv, epsilon);
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

  function addSegmentEvents(segment) {
    var v1 = segment.v1, v2 = segment.v2;

    // make events
    var event1 = new SweepEvent(v1);
    var event2 = new SweepEvent(v2);

    // link events to each other
    event1.twin = event2;
    event2.twin = event1;

    var vertical = v1[ah] === v2[ah];
    var dir = vertical ? v1[av] < v2[av] : v1[ah] < v2[ah];

    event1.vertical = event2.vertical = vertical;

    // assign flags
    // (v1 and v2 assigned s.t. poly interior is on left of v1 -> v2 edge; inOut
    // flag is true if vertical line going up through v1 -> v2 edge transitions
    // from inside polygon to outside)
    // if vertical:
    //  if points up, poly interior is on left, v1 is first (left) point
    //  else, poly interior is on right, v2 is first (left) point
    // else:
    //  if points right, poly interior is up, v1 is first (left) point
    //  else, poly interior is down, v2 is first (left) point
    event1.inOut = event2.inOut = !dir;
    event1.isLeft = dir;
    event2.isLeft = !event1.isLeft;

    // set slopes (infinite for vertical); invert if segment points left
    var slope;
    if (vertical) slope = dir ? Infinity : -Infinity;
    else slope = (v2[av] - v1[av]) / (v2[ah] - v1[ah]);

    event1.slope = slope;
    event2.slope = slope;

    sweepEvents.queue(event1);
    sweepEvents.queue(event2);
  }

  function eventIntersection(a, b) {
    if (a === null || b === null || a.endpointsCoincident(b, epsilon)) return null;

    return segmentSegmentIntersectionE(a.v, a.twin.v, b.v, b.twin.v, axis, epsilon);
  }

  // given the left endpoint e of an event pair, split it at vertex vi
  function eventSplit(e, vi) {
    var te = e.twin;

    // don't split if intersection point is on the end of the segment
    if (coincident(te.v, vi, epsilon)) return;

    // events left and right of intersection point
    var ei = new SweepEvent(vi);
    var ite = new SweepEvent(vi);

    ei.copyAttributes(te);
    ite.copyAttributes(e);

    e.twin = ei;
    te.twin = ite;

    sweepEvents.queue(ei);
    sweepEvents.queue(ite);
  }

  function eventValid(e) {
    if (e.depthBelow === 0 && e.depthAbove === 1) return true;
    if (e.depthBelow === 1 && e.depthAbove === 0) return true;

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
  this.vertical = false;
  this.isLeft = false;
  this.inOut = false;
  this.slope = 0;
}

// for a segment's left event, given position h on the horizontal axis,
// calculate its vertical axis position at h
SweepEvent.prototype.vath = function(h, ah, av) {
  var v = this.v;

  if (this.vertical) return v[av];
  else return v[av] + this.slope * (h - v[ah]);
}

SweepEvent.prototype.setDepth = function(eventBelow) {
  var depthBelow = eventBelow !== null ? eventBelow.depthAbove : 0;

  this.depthBelow = depthBelow;
  this.depthAbove = this.inOut ? depthBelow - 1 : depthBelow + 1;
}

SweepEvent.prototype.endpointsCoincident = function(other, epsilon) {
  if (coincident(this.v, other.v, epsilon)) return true;
  if (coincident(this.twin.v, other.twin.v, epsilon)) return true;

  return false;
}

SweepEvent.prototype.copyAttributes = function(source) {
  this.depthBelow = source.depthBelow;
  this.depthAbove = source.depthAbove;

  this.twin = source.twin;
  this.vertical = source.vertical;
  this.isLeft = source.isLeft;
  this.inOut = source.inOut;
  this.slope = source.slope;
}
