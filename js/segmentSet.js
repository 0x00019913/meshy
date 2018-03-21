function SegmentSet(axis) {
  this.axis = axis;
  this.ah = cycleAxis(axis);
  this.av = cycleAxis(this.ah);
  this.up = makeAxisUnitVector(axis);

  this.segments = [];
}

SegmentSet.prototype.addSegment = function(v1, v2, normal) {
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

  var segments = this.segments;
  var ns = segments.length;

  // priority queue storing events from left to right
  var sweepEvents = new PriorityQueue({ comparator: pqComparator });
  for (var s = 0; s < ns; s++) {
    addSegmentEvents(sweepEvents, segments[s]);
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
      status.insert(event);
      var it = status.findIter(event);
      var prev = it.prev();
      var next = it.next();

      if (prev && prev.isLeft) {
        var ip = segmentSegmentIntersectionE(event.v, event.other.v, prev.v, prev.other.v, axis);
        if (ip) {
          console.log("intersection");
          debug.line(event.v, ip);
        }
      }
    }
    else {
      status.remove(event.other);
    }
    o += 0.1;
  }

  debug.lines();

  // primary sorting on horizontal coordinate (x if up axis is z)
  // secondary sorting on vertical coordinate (y if up axis is z)
  function pqComparator(a, b) {
    var va = a.v, vb = b.v;
    var vah = va[ah], vbh = vb[ah];

    if (vah < vbh) return -1;
    else if (vah > vbh) return 1;
    else {
      var vav = va[av], vbv = vb[av];
      if (vav < vbv) return -1;
      else return 1;
    }
  }

  // primary sorting on vertical coordinate (y if up axis is z)
  // secondary sorting on slope
  // tertiary sorting on other event's vertical coordinate
  function rbtComparator(a, b) {
    var va = a.v, vb = b.v;
    var vav = va[av], vbv = vb[av];

    if (vav < vbv) return -1;
    else if (vav > vbv) return 1;
    else {
      var as = a.slope, bs = b.slope;
      if (as < bs) return -1;
      else if (as > bs) return 1;
      else {
        var vaov = a.other.v[av], vbov = b.other.v[av];
        if (vaov < vbov) return -1;
        else if (vaov > vbov) return 1;
        else return 0;
      }
    }
  }

  function addSegmentEvents(sweepEvents, segment) {
    var v1 = segment.v1, v2 = segment.v2;

    // make events
    var event1 = new SweepEvent(v1);
    var event2 = new SweepEvent(v2);

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

    // link events to each other
    event1.other = event2;
    event2.other = event1;

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
  this.other = null;
  this.inOut = false;
  this.slope = 0;
}
