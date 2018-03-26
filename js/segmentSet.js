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
    addSegmentEvents(sweepEvents, segments[s]);
    //debug.line(segments[s].v1, segments[s].v2);
  }

  // reinitialize array of segments because we'll rebuild this
  segments = [];

  // structure storing the sweep line status
  var status = new RBTree(rbtComparator);

  var o = 0;
  while (sweepEvents.length > 0) {
    var event = sweepEvents.dequeue();

    debug.point(event.v, o, this.axis);

    if (event.isLeft) {
      var iter = status.iterator(), ev;
      while ((ev = iter.next()) !== null) {
        debug.line(event.v, ev.v.clone().add(ev.twin.v).divideScalar(2));
      }

      status.insert(event);
      var it = status.findIter(event);
      var up = it.next();
      var down = it.prev();

      if (down) {
        var id = segmentSegmentIntersectionE(event.v, event.twin.v, down.v, down.twin.v, axis);
        if (id) {
          debug.line(event.v, down.v);
          debug.line(event.v, id);
          debug.line(down.v, id);
        }
      }

      if (up) {
        var iu = segmentSegmentIntersectionE(event.v, event.twin.v, up.v, up.twin.v, axis);
        if (iu) {
          debug.line(event.v, up.v);
          debug.line(event.v, iu);
          debug.line(up.v, iu);
        }
      }
    }
    else {
      status.remove(event.twin);
    }
    o += 0.1;
  }

  debug.lines();

  // primary sorting on horizontal coordinate (x if up axis is z)
  // secondary sorting on left/right (right goes first so that, given two
  //    segments sharing an endpoint but with no vertical overlap, the left
  //    segment leaves the sweep status structure before the next goes in)
  // tertiary sorting on vertical coordinate (y if up axis is z)
  // quaternary sorting on slope
  function pqComparator(a, b) {
    if (a === b) return 0;

    var va = a.v, vb = b.v;
    var vah = va[ah], vbh = vb[ah];
    var comp0 = compare(vah, vbh, epsilon);

    if (comp0 !== 0) return comp0;
    else {
      if (!a.isLeft && b.isLeft) return -1;
      else if (a.isLeft && !b.isLeft) return 1;
      else {
        var vav = va[av], vbv = vb[av];
        var comp2 = compare(vav, vbv, epsilon);

        if (comp2 !== 0) return comp2;
        else {
          var as = a.slope, bs = b.slope;
          var comp3 = compare(as, bs, epsilon);

          return comp3;
        }
      }
    }
  }

  // primary sorting on vertical coordinate (y if up axis is z)
  // secondary sorting on slope
  // tertiary sorting on twin event's vertical coordinate
  function rbtComparator(a, b) {
    if (a === b) return 0;

    var va = a.v, vb = b.v;
    var vav = va[av], vbv = vb[av];
    var comp0 = compare(vav, vbv, epsilon);

    if (comp0 !== 0) return comp0;
    else {
      var as = a.slope, bs = b.slope;
      var comp1 = compare(as, bs, epsilon);

      if (comp1 !== 0) return comp1;
      else {
        var vatv = a.twin.v[av], vbtv = b.twin.v[av];
        var comp2 = compare(vatv, vbtv, epsilon);

        return comp2;
      }
    }
  }

  function addSegmentEvents(sweepEvents, segment) {
    var v1 = segment.v1, v2 = segment.v2;

    // make events
    var event1 = new SweepEvent(v1);
    var event2 = new SweepEvent(v2);

    // link events to each other
    event1.twin = event2;
    event2.twin = event1;

    var vertical = v1[ah] === v2[ah];
    var dir = vertical ? v1[av] < v2[av] : v1[ah] < v2[ah];

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
    else slope = (dir ? 1 : -1) * (v2[av] - v1[av]) / (v2[ah] - v1[ah]);

    event1.slope = slope;
    event2.slope = slope;

    sweepEvents.queue(event1);
    sweepEvents.queue(event2);
  }
}

function Segment(v1, v2) {
  this.v1 = v1;
  this.v2 = v2;
}

function SweepEvent(v) {
  this.v = v;
  this.isLeft = false;
  this.twin = null;
  this.inOut = false;
  this.slope = 0;
}

SweepEvent.prototype.endpointsCoincident = function(other, epsilon) {
  if (coincident(this.v, other.v, epsilon)) return true;
  if (coincident(this.twin.v, other.twin.v, epsilon)) return true;

  return false;
}
