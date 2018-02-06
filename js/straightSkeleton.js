SSHalfedge = function(node) {
  this.id = -1;
  this.node = node;
  this.next = null;
  this.twin = null;
}

SSHalfedge.prototype.prev = function() {
  var twin = this.twin;

  while (twin.next != this) twin = twin.next.twin;

  return twin;
}

SSHalfedge.prototype.nstart = function() {
  return this.node;
}

SSHalfedge.prototype.nend = function() {
  return this.next.node;
}

SSHalfedge.prototype.rotated = function() {
  return this.twin.next;
}

SSHalfedgeFactory = function() {
  this.id = 0;
  this.halfedges = [];
}

SSHalfedgeFactory.prototype.create = function(node) {
  var halfedge = new SSHalfedge(node);

  this.halfedges.push(halfedge);
  halfedge.id = this.id++;

  return halfedge;
}



SSNode = function(v, L) {
  this.id = -1;
  // vertex
  this.v = v;
  // one of the 1+ halfedges starting at this node
  this.halfedge = null;
  // true if reflex contour vertex
  this.reflex = false;
  // the "time" at which this node was formed
  this.L = L !== undefined ? L : 0;
}

SSNode.prototype.isolated = function() {
  return this.halfedge == null;
}

SSNode.prototype.terminal = function() {
  return this.halfedge.twin.next == this.halfedge;
}

SSNode.prototype.setReflex = function(reflex) {
  this.reflex = reflex;
}

SSNodeFactory = function() {
  this.id = 0;
  this.nodes = [];
}

SSNodeFactory.prototype.create = function(v, L) {
  var node = new SSNode(v, L);

  this.nodes.push(node);
  node.id = this.id++;

  return node;
}



SSConnector = function(nfactory, hefactory) {
  this.nfactory = nfactory;
  this.hefactory = hefactory;
}

SSConnector.prototype.connectNodeToNode = function(nsource, ntarget) {
  var st = this.hefactory.create(nsource);
  var ts = this.hefactory.create(ntarget);

  // the halfedge listed on the node is arbitrary, so set it here to make sure
  nsource.halfedge = st;
  ntarget.halfedge = ts;

  st.twin = ts;
  st.next = ts;
  ts.twin = st;
  ts.next = st;

  return ts;
}

// connect the vertex node starting at the source halfedge to the given
// isolated node
SSConnector.prototype.connectHalfedgeToNode = function(hesource, ntarget) {
  if (!ntarget.isolated()) return null;

  var nsource = hesource.node;

  var hesourceIn = hesource.prev();
  var hesourceOut = hesource;

  // create the connecting halfedges
  var hetargetsource = this.connectNodeToNode(nsource, ntarget);
  var hesourcetarget = hetargetsource.twin;

  // link the halfedges correctly
  hesourceIn.next = hesourcetarget;
  hetargetsource.next = hesourceOut;

  return hetargetsource;
}

// connect the vertex node starting at the source halfedge to the vertex node
// starting at the target halfedge while preserving orientation;
// this is distinct from .connectHalfedgeToNode because we don't necessarily
// know which of the incoming/outgoing halfedge pairs incident on the target
// node should be connected
SSConnector.prototype.connectHalfedgeToHalfedge = function(hesource, hetarget) {
  var nsource = hesource.node;
  var ntarget = hetarget.node;

  var hesourceIn = hesource.prev();
  var hesourceOut = hesource;

  var hetargetIn = hetarget.prev();
  var hetargetOut = hetarget;

  // create the connecting halfedges
  var hetargetsource = this.connectNodeToNode(nsource, ntarget);
  var hesourcetarget = hetargetsource.twin;

  // link the halfedges correctly

  hesourceIn.next = hesourcetarget;
  hesourcetarget.next = hetargetOut;

  hetargetIn.next = hetargetsource;
  hetargetsource.next = hesourceOut;

  return hetargetsource;
}



// represents a bidirectional edge coincident with a particular halfedge that's
// interior to the polygon (i.e., regardless of winding, polygon interior is on
// the left)
// helper class meant to make edge-related operators clearer
SSEdge = function(he) {
  this.id = -1;

  this.he = he;

  var start = he.nstart().v;
  var end = he.nend().v;

  this.start = start;
  this.end = end;

  this.forward = end.clone().sub(start).normalize();
  this.backward = this.forward.clone().negate();

  // set of LAV node IDs for nodes that have this edge as their forward edge
  this.lnodes = new Set();
}

SSEdge.prototype.addNode = function(lnode) {
  this.lnodes.add(lnode.id);
}

SSEdge.prototype.removeNode = function(lnode) {
  this.lnodes.delete(lnode.id);
}

SSEdge.prototype.replaceNode = function(lnodeOld, lnodeNew) {
  this.removeNode(lnodeOld);
  this.addNode(lnodeNew);
}

SSEdgeFactory = function() {
  this.id = 0;
}

SSEdgeFactory.prototype.create = function(he) {
  var edge = new SSEdge(he);

  edge.id = this.id++;

  return edge;
}



// represents a node in a circular, double-linked list of active vertices
SSLAVNode = function(he) {
  this.id = -1;

  // skeleton halfedge that starts at this vertex
  this.he = he;
  // for ease of access
  this.v = he.node.v;
  this.L = he.node.L;
  this.reflex = he.node.reflex;

  // prev/next nodes in lav
  this.prev = null;
  this.next = null;

  // flag - true means that the vert will not take part in further events
  this.processed = false;

  // forward and backward edges
  this.ef = null;
  this.eb = null;

  // normalized bisecting vector
  this.bisector = null;
}

SSLAVNode.prototype.setProcessed = function() {
  // unlink this LAV node's edge from this node
  this.ef.removeNode(this);
  // set flag
  this.processed = true;
}

SSLAVNode.prototype.setEdgeForward = function(edge) {
  // unlink the current LAV node from this edge
  if (this.ef) this.ef.removeNode(this);
  // link this LAV node to the edge
  edge.addNode(this);
  // set edge
  this.ef = edge;
}

SSLAVNode.prototype.setEdgeBackward = function(edge) {
  // set backward edge
  this.eb = edge;
}

SSLAVNodeFactory = function() {
  this.id = 0;
  this.lnodes = [];
}

SSLAVNodeFactory.prototype.create = function(he) {
  var lnode = new SSLAVNode(he);

  this.lnodes.push(lnode);
  lnode.id = this.id++;

  return lnode;
}



// basically an enum we'll use to bitmask
var SSEventTypes = {
  noEvent: 0,
  edgeEvent: 1,
  splitEvent: 2,
  startSplitEvent: 4,
  endSplitEvent: 8
}

SSEvent = function(lnode) {
  this.type = SSEventTypes.noEvent;

  this.lnode = lnode;

  // intersection point (edge and split events); null if no intersection
  this.intersection = null;

  // distance from event point to all edges involved in the event
  this.L = Infinity;

  // event type - either edge or split, edge by default
  this.type = SSEventTypes.noEvent;
  // the other node involved in an event:
  // if edge event, this is the neighbor node that intersects the bisector;
  // if split event, this is node A such that the split edge starts at A
  this.otherNode = null;
}

// straight skeleton uses a halfedge data structure; initialize from a polygon
// with holes so that initial halfedges wind CCW around interior of every
// contour and CW around the exterior of every contour;
// poly is assumed a closed, simple CCW contour with holes
//
// this implementation is based on Petr Felkel's paper with the addition of
// special "start" and "end" split events, in which a split event falls exactly
// on one of the split edge's bisectors (CGAL refers to these as "pseudo split
// events"), IIRC
StraightSkeleton = function(poly) {
  var axis = poly.axis;
  var epsilon = poly.epsilon !== undefined ? poly.epsilon : 0.0000001;

  this.axis = axis;
  this.ah = poly.ah;
  this.av = poly.av;
  this.epsilon = epsilon;

  // used for optimization
  this.hasHoles = poly.holes.length > 0;

  // array of halfedges, one per separate contour
  this.entryHalfedges = [];

  this.nfactory = new SSNodeFactory();
  this.hefactory = new SSHalfedgeFactory();
  this.connector = new SSConnector(this.nfactory, this.hefactory);
  this.lfactory = new SSLAVNodeFactory();
  this.efactory = new SSEdgeFactory();

  this.makePQ();

  this.buildContour(poly);

  this.buildInterior();
}

StraightSkeleton.prototype.makePQ = function() {
  // pq retrieves smallest-L node first
  var pqComparator = function (a, b) { return a.L - b.L; }

  this.pq = new PriorityQueue({
    comparator: pqComparator,
    // using BHeap instead of the default because the default exhibits strange
    // behavior I can't reproduce in a controlled environment - an occasional
    // event would come off the PQ out of order.
    // I'd assumed this was because I originally used LAV nodes to store events,
    // so I could end up recalculating an event on the same object and pushing
    // it to the PQ twice, but apparently this still happens even if I wrap the
    // LAV nodes in event objects that are created for every recalculation.
    // so I dunno.
    strategy: PriorityQueue.BHeapStrategy
  });
}

StraightSkeleton.prototype.queueEvent = function(event) {
  if (event.type != SSEventTypes.noEvent) this.pq.queue(event);
}

// make the contour nodes + halfedges
StraightSkeleton.prototype.buildContour = function(poly) {
  var nfactory = this.nfactory;
  var connector = this.connector;

  var nodes = nfactory.nodes;

  // polygon and its holes in one array
  var contours = [poly].concat(poly.holes);

  // make vertex nodes and halfedges for every vert/edge in every contour
  for (var c = 0; c < contours.length; c++) {
    var cnode = contours[c].vertex;

    var count = 0;
    var nstart = null;
    var heprev = null;

    var curr = cnode;
    do {
      var v = curr.v;

      var n = nfactory.create(v, 0);
      n.setReflex(curr.reflex);

      if (count == 0) nstart = n;
      else {
        var he;

        if (count == 1) he = connector.connectNodeToNode(nstart, n);
        else he = connector.connectHalfedgeToNode(heprev, n);

        heprev = he;

        he.contour = true;
        he.twin.contour = true;
      }

      count++;

      curr = curr.next;
    } while (curr != cnode);

    // close the gap between last and first nodes
    heprev = connector.connectHalfedgeToHalfedge(heprev, nstart.halfedge);

    this.entryHalfedges.push(heprev.twin);
  }
}

// process events and fill out the internal nodes + halfedges
StraightSkeleton.prototype.buildInterior = function() {
  var axis = this.axis;
  var epsilon = this.epsilon;

  var pq = this.pq;

  var nfactory = this.nfactory;
  var hefactory = this.hefactory;
  var connector = this.connector;
  var lfactory = this.lfactory;

  var contourNodeCount = nfactory.nodes.length; // todo: remove

  var lnodes = lfactory.lnodes;

  var slav = this.makeslav();

  this.calculateInitialEvents(slav);

  var ct = 0;
  var lim = 1580;
  var t = true, f = false;
  var limitIterations = t;
  var skeletonShiftDistance = -0.1;
  var iterativelyShiftSkeleton = f;
  var validate = t;

  var prevL = 0;

  while (pq.length > 0) {
    ct++;
    if (limitIterations && ct > lim) break;

    var event = pq.dequeue();

    if (less(event.L, prevL, epsilon)) console.log("EVENT IN WRONG ORDER", prevL, event.L);
    prevL = Math.max(prevL, event.L);

    var lnodeV = event.lnode;

    if (validate) {
      var validated = true;
      validated = validateEdges(this.edges, lnodes);
      if (!validated) {
        console.log(ct);
        break;
      }

      validated = validateLAV(lnodeV);
      if (!validated) {
        console.log(ct);
        break;
      }
    }

    var logEvent = t;
    var debugResultLav = t;

    var eventType = event.type;

    if (eventType == SSEventTypes.noEvent) continue;

    var vI = event.intersection;
    var lnodeE = event.otherNode;

    if (eventType & SSEventTypes.edgeEvent) {
      if (logEvent) console.log(ct, "edge event", event.L);
      // in edge event, V's bisector intersects one of its neighbors' bisectors,
      // resulting in the collapse of the edge between them to an internal
      // straight skeleton node

      // set the two nodes such that B is CCW from A
      var lnodeA, lnodeB;

      // if E CW of V
      if (lnodeE == lnodeV.prev || lnodeE.next == lnodeV) {
        lnodeA = lnodeE;
        lnodeB = lnodeV;
      }
      // if V CW of E
      else if (lnodeV == lnodeE.prev || lnodeV.next == lnodeE) {
        lnodeA = lnodeV;
        lnodeB = lnodeE;
      }
      else {
        if (logEvent) console.log("NODES DON'T MATCH, DISCARD");
        continue;
      }

      var procA = lnodeA.processed;
      var procB = lnodeB.processed;

      if (ct >= lim) {
        debugPt(lnodeA.v, 0.1, true);
        debugPt(lnodeB.v, 0.2, true);
        //debugLAV(procA ? lnodeB : lnodeA, 2, 250, true, 0);
      }

      if (logEvent && ((procA && procB) || lnodeV.processed)) console.log("DISCARD");
      if ((procA && procB) || lnodeV.processed) continue;

      var lnodeI;

      // if A is processed and B is not processed
      if (procA) {
        if (logEvent) console.log("A PROCESSED");

        lnodeI = lnodeB.prev;
        if (less(lnodeI.L, lnodeB.L, epsilon)) continue;

        // connect
        lnodeI.next = lnodeB.next;
        lnodeB.next.prev = lnodeI;

        lnodeI.setEdgeForward(lnodeB.ef);
        lnodeB.setProcessed();

        lnodeI.he = connector.connectHalfedgeToHalfedge(lnodeB.he, lnodeI.he);
      }
      // if A is not processed and B is processed
      else if (procB) {
        if (logEvent) console.log("B PROCESSED");

        lnodeI = lnodeA.next;
        if (less(lnodeI.L, lnodeA.L, epsilon)) continue;

        lnodeI.prev = lnodeA.prev;
        lnodeA.prev.next = lnodeI;

        lnodeI.setEdgeBackward(lnodeA.eb);
        lnodeA.setProcessed();

        connector.connectHalfedgeToHalfedge(lnodeA.he, lnodeI.he);
      }
      else {
        if (lnodeB.next == lnodeA) {
          if (logEvent) console.log("2-NODE LAV, CONTINUE");
          connector.connectHalfedgeToHalfedge(lnodeA.he, lnodeB.he);
          lnodeA.setProcessed();
          lnodeB.setProcessed();

          continue;
        }

        // new node at intersection
        var nI = nfactory.create(vI, event.L);

        // link A to I
        var heA = lnodeA.he;
        var heIA = connector.connectHalfedgeToNode(heA, nI);
        lnodeA.setProcessed();

        // link B to I
        var heB = lnodeB.he;
        var heIB = connector.connectHalfedgeToHalfedge(heB, heIA);
        lnodeB.setProcessed();

        // reached a peak of the roof, so close it with a third halfedge
        if (lnodeA.prev.prev == lnodeB) {
          if (logEvent) console.log("PEAK");
          var lnodeC = lnodeA.prev;
          var heC = lnodeC.he;

          connector.connectHalfedgeToHalfedge(heC, heIB);
          lnodeC.setProcessed();

          continue;
        }

        // make a new LAV node at the intersection
        lnodeI = lfactory.create(heIB);

        var newprev = lnodeA.prev;
        var newnext = lnodeB.next;
        newprev.next = lnodeI;
        lnodeI.prev = newprev;
        newnext.prev = lnodeI;
        lnodeI.next = newnext;

        lnodeI.setEdgeForward(lnodeB.ef);
        lnodeI.setEdgeBackward(lnodeA.eb);
      }

      var eventI = new SSEvent(lnodeI);
      this.calculateBisector(lnodeI);
      this.calculateEdgeEvent(eventI);
      this.queueEvent(eventI);

      if (ct >= lim) {
        debugLAV(lnodeI, 2, 250, true, 0);
        debugPt(eventI.intersection, 0.5, true);
      }
    }

    else if (eventType & SSEventTypes.splitEvent) {
      if (logEvent) {
        var logstring = "split event";
        if (eventType & SSEventTypes.startSplitEvent) logstring += " START";
        if (eventType & SSEventTypes.endSplitEvent) logstring += " END";
        console.log(ct, logstring, event.L);
      }
      // in split event, V's bisector causes a given A-B edge to split.
      // the new node structure looks like this:
      //
      // B---A
      //  *?*
      //   I
      //   |
      //   V
      //  / \
      // P   N
      // where the original LAV went P -> V -> N -> ... -> A -> B -> ... -> P; we
      // create an I hanging off the V, splitting the LAV on either side of I.
      // In the following:
      // "right" denotes the ... -> P -> I -> B -> ... sequence and
      // "left" denotes the ... -> A -> I -> N -> ... sequence
      // except for the special cases where I is directly on the bisector of
      // A, B, or both (referred to as start split and end split, respectively)

      if (ct >= lim) {
        debugPt(lnodeV.v, 0.1, true);
        debugLn(lnodeE.ef.start, lnodeE.ef.end, 0.4, 0);
      }

      if (logEvent && lnodeV.processed) console.log("DISCARD");
      if (lnodeV.processed) continue;

      // true if intersection is on the start/end bisectors, respectively
      var startSplit = !!(eventType & SSEventTypes.startSplitEvent);
      var endSplit = !!(eventType & SSEventTypes.endSplitEvent);

      // the edge that's split
      var edge = lnodeE.ef;

      var lnodeA = lnodeE;

      // see which LAV nodes F are associated with the edge - choose one of
      // these to split
      for (var lidx of edge.lnodes) {
        var lnodeF = lnodes[lidx];
        var lnodeS = lnodeF.next;
        var vF = lnodeF.v;
        var vS = lnodeS.v;
        var vFoffset = vF.clone().add(lnodeF.bisector);
        var vSoffset = vS.clone().add(lnodeS.bisector);

        // intersection must be within the sweep area between F and S
        if (left(vF, vFoffset, vI, axis, epsilon)) continue;
        if (left(vSoffset, vS, vI, axis, epsilon)) continue;

        lnodeA = lnodeF;
        break;
      }

      var lnodeB = lnodeA.next;

      if (ct >= lim) {
        debugPt(lnodeA.v, 0.2, true);
        debugPt(lnodeB.v, 0.2, true);
        debugPt(vI, 0.3, true);
      }

      if (logEvent && (lnodeA.processed && lnodeB.processed)) console.log("UPDATE: DISCARD");
      if (lnodeA.processed && lnodeB.processed) continue;

      // V's predecessor and successor
      var lnodeP = lnodeV.prev;
      var lnodeN = lnodeV.next;

      // put a new skeleton vertex node at split point
      var nI = nfactory.create(vI, event.L);

      // halfedge from V
      var heV = lnodeV.he;

      // connect V to I
      var heIV = connector.connectHalfedgeToNode(heV, nI);
      lnodeV.setProcessed();

      // split the LAV in two by creating two new LAV nodes at the intersection
      // and linking their neighbors and the split edge's endpoints accordingly

      // new LAV node on the A-N side of I (right node is always at the start
      // of the IV halfedge)
      var lnodeRight = lfactory.create(heIV);
      // new LAV node on the M-B side of I
      var lnodeLeft = null;

      // if intersection is on A or B bisector, link I to one or both and make
      // the left LAV node accordingly
      if (startSplit && endSplit) {
        var heIA = connector.connectHalfedgeToHalfedge(lnodeA.he, heIV);
        var heIB = connector.connectHalfedgeToHalfedge(lnodeB.he, heIA);
        lnodeLeft = lfactory.create(heIB);
      }
      else if (startSplit) {
        var heIA = connector.connectHalfedgeToHalfedge(lnodeA.he, heIV);
        lnodeLeft = lfactory.create(heIA);
      }
      else if (endSplit) {
        var heIB = connector.connectHalfedgeToHalfedge(lnodeB.he, heIV);
        lnodeLeft = lfactory.create(heIB);
      }
      else {
        lnodeLeft = lfactory.create(heIV);
        // note to self: bug here? heIV is on the A-N side, so we might break
        // the edge flow if we try to connect on the P-B side to heIV.
        // possibly fix by tracking the *incoming* halfedge instead and, when we
        // try to connect to a LAV node with such an edge, use its next instead.
        // shouldn't be important for offsetting, though.
      }

      // link the new LAV nodes accounting for the possibility that A and/or B
      // were eliminated by an exact bisector intersection

      // I's neighbors depend on whether a start/end split occurred
      // prev node on A-I-N side
      var lnodeRPrev = startSplit ? lnodeA.prev : lnodeA;
      // next node on P-I-B side
      var lnodeLNext = endSplit ? lnodeB.next : lnodeB;

      // link A-N side of I
      lnodeRPrev.next = lnodeRight;
      lnodeRight.prev = lnodeRPrev;
      lnodeN.prev = lnodeRight;
      lnodeRight.next = lnodeN;

      // link P-B side of I
      lnodeP.next = lnodeLeft;
      lnodeLeft.prev = lnodeP;
      lnodeLNext.prev = lnodeLeft;
      lnodeLeft.next = lnodeLNext;

      // A and/or B can be eliminated by start/end split
      if (startSplit) lnodeA.setProcessed();
      if (endSplit) lnodeB.setProcessed();

      lnodeRight.setEdgeForward(lnodeV.ef);
      lnodeRight.setEdgeBackward(startSplit ? lnodeA.eb : lnodeA.ef)
      lnodeLeft.setEdgeForward(endSplit ? lnodeB.ef : lnodeB.eb);
      lnodeLeft.setEdgeBackward(lnodeP.ef);

      this.calculateReflex(lnodeRight);
      this.calculateBisector(lnodeRight);
      this.calculateReflex(lnodeLeft);
      this.calculateBisector(lnodeLeft);

      // final processing:
      // 1. if V is adjacent to A/B, link A/B to the right/left node, resp.;
      // 2. if one or both of the split LAVs incident on I ended up being
      // degenerate (containing only two verts), just link those two verts with
      // a halfedge;
      // 3. else, calculate bisectors and potential new events

      // A-N side of I
      if (lnodeN == lnodeA) {
        connector.connectHalfedgeToHalfedge(lnodeA.he, lnodeRight.he);
        lnodeA.setProcessed();
        lnodeRight.setProcessed();
        console.log("right split empty");
      }
      else if (lnodeRight.prev == lnodeRight.next) {
        connector.connectHalfedgeToHalfedge(heIV, lnodeRight.prev.he);
        lnodeRight.setProcessed();
        lnodeRight.next.setProcessed();
        console.log("right split degenerate");
      }
      // else, update bisectors and events
      else {
        var eventRight = new SSEvent(lnodeRight);
        this.calculateEdgeEvent(eventRight);
        if (!startSplit) this.queueEvent(eventRight);
      }

      // P-B side of I
      if (lnodeP == lnodeB) {
        connector.connectHalfedgeToHalfedge(lnodeB.he, lnodeLeft.he);
        lnodeB.setProcessed();
        lnodeLeft.setProcessed();
        console.log("left split empty");
      }
      else if (lnodeLeft.next == lnodeLeft.prev) {
        connector.connectHalfedgeToHalfedge(lnodeLeft.he, lnodeLeft.next.he);
        lnodeLeft.setProcessed();
        lnodeLeft.next.setProcessed();
        console.log("left split degenerate");
      }
      else {
        var eventLeft = new SSEvent(lnodeLeft);
        this.calculateEdgeEvent(eventLeft);
        if (!endSplit) this.queueEvent(eventLeft);
      }

      if (ct >= lim) {
        if (lnodeN != lnodeA) debugLAV(lnodeRight, 7, 250, true, 0.02)
        if (lnodeP != lnodeB) debugLAV(lnodeLeft, 6, 250, true, 0.02);
      }
    }
  }

  debugSkeleton();

  function debugPQ() {
    while (pq.length>0) {
      var event = pq.dequeue();
      var lnodeV = event.lnode;
      var lnodeE = event.otherNode;

      var lnodeA, lnodeB;

      // if E CW of V
      if (lnodeE == lnodeV.prev || lnodeE.next == lnodeV) {
        lnodeA = lnodeE;
        lnodeB = lnodeV;
      }
      // if V CW of E
      else if (lnodeV == lnodeE.prev || lnodeV.next == lnodeE) {
        lnodeA = lnodeV;
        lnodeB = lnodeE;
      }

      debugLn(lnodeA.v, event.intersection, 2, 2);
      debugLn(lnodeB.v, event.intersection, 2, 2);
    }
  }

  function debugSkeleton() {
    var offset = skeletonShiftDistance;
    var nodes = nfactory.nodes;
    for (var i=contourNodeCount; i<nodes.length; i++) {
      var node = nodes[i];

      var he = node.halfedge;
      do {
        var vs = node.v.clone();
        var ve = he.nend().v.clone();
        vs.z += offset;
        ve.z += offset;
        debugLine(vs, ve);

        he = he.rotated();
      } while (he != node.halfedge);
      if (iterativelyShiftSkeleton) offset += -0.1;
    }
    debugLines();
  }

  function validateEdges(edges, lnodes) {
    var valid = true;

    for (var e=0; e<edges.length; e++) {
      var edge = edges[e];
      for (var lidx of edge.lnodes) {
        var lnode = lnodes[lidx];
        if (lnode.ef!=edge) {
          valid = false;
          console.log("WRONG EDGE ON NODE", lnode, edge);
          debugLn(lnode.v, lnode.next.v, 0.2, 1);
          debugLn(edge.start, edge.end, 0.4, 2);
        }
      }
    }

    for (var l=0; l<lnodes.length; l++) {
      var lnode = lnodes[l];
      if (lnode.processed) continue;

      var ef = lnode.ef;
      if (!ef.lnodes.has(lnode.id)) {
        valid = false;
        console.log("NODE NOT PRESENT IN EDGE'S SET", lnode, ef);
        debugLn(lnode.v, lnode.next.v, 0.2, 1, true);
        debugLn(ef.start, ef.end, 0.4, 2);
      }
    }

    return valid;
  }

  function validateLAV(start) {
    var valid = true;
    var seen = new Set();

    if (start.processed) return true;

    var lnode = start;
    do {
      if (seen.has(lnode.id)) {
        console.log("LOOP WITH NODE", lnode.id);
        valid = false;
        break;
      }

      if (lnode.next.prev != lnode) {
        console.log("BRANCH AT NODE", lnode.id);
        valid = false;
        break;
      }

      seen.add(lnode.id);
      lnode = lnode.next;
    } while (lnode != start);

    return valid;
  }

  function debugPt(v, o, includeStart, c) {
    if (o===undefined) o = 0;
    if (c===undefined) c = 0;

    var vcopy = v.clone();
    vcopy.z += o;
    debugVertex(vcopy);

    if (includeStart) {
      debugLine(v, vcopy);
    }
    debugLines(c);
  }

  function debugLn(v, w, o, c, dir) {
    if (o===undefined) o = 0;
    if (c===undefined) c = 0;

    var vcopy = v.clone();
    var wcopy = w.clone();
    vcopy.z += o;
    wcopy.z += o;

    if (dir) debugLine(vcopy, wcopy, 10, true);
    else debugLine(vcopy, wcopy);
    debugLines(c);
  }

  function debugRay(v, r, o, c, l, dir) {
    var bp = r.clone().setLength(l);
    var vo = v.clone().add(bp);
    debugLn(v, vo, o, c, dir);
  }

  function debugLAV(lnode, c, maxct, bisectors, increment, edges) {
    if (maxct === undefined) maxct = Infinity;
    if (increment === undefined) increment = 0.05;

    if (lnode.processed) return;

    var dct = 0;
    if (debugResultLav) {
      var o = 0;
      var lv = lnode;
      do {
        c = c===undefined ? 0 : c;
        debugLn(lv.v, lv.next.v, o, c, false);
        //debugPt(lv.v, o-increment, true, c);
        if (bisectors && lv.bisector) debugRay(lv.v, lv.bisector, o, c+2, 0.1);
        if (edges) {
          var edgeCenter = lv.ef.start.clone().add(lv.ef.end).multiplyScalar(0.5);
          debugLn(lv.v, edgeCenter, o, c+3, true);
        }

        lv = lv.next;
        o += increment;
        if (++dct > maxct) {
          console.log("debugging LAV node", lv.id, "went over the limit", maxct);
          break;
        }
      } while (lv != lnode);
    }
  }

  function debugEdge(edge, c, oo) {
    if (oo===undefined) oo = 0;

    var ddct = 0;
    for (var lx of edge.lnodes) {
      ddct++;
      var lnode = lnodes[lx];
      //debugPt(lnode.v, -0.1*ddct);
      debugLAV(lnode, c, 250, true, oo);
    }
    console.log(ddct);
  }

  function debugEvent(lnode) {
    var evt = lnode.eventType;
    var en = lnode.otherNode;
    if (evt&SSEventTypes.edgeEvent) {
      debugPt(lnode.v, -0.1, true, 0);
      debugPt(en.v, -0.1, true, 0);
      var eef = en.ef;
      debugLn(eef.start, eef.end, -0.1, 0, true);
      debugPt(lnode.intersection, -0.2, true, 0);
    }
    else if (evt&SSEventTypes.splitEvent) {
      debugPt(lnode.v, -0.2, true, 1);
      var eef = lnode.otherNode.ef;
      debugLn(eef.start, eef.end, -0.2, 1, true);
      debugPt(lnode.intersection, -0.3, true, 1);
    }
  }

  return;
}

// LAV: list of active vertices (technically, halfedges originating from the
// active vertices), one for each contour
// SLAV: set of LAVs - the current fronts for propagating the skeleton
//
// creates a SLAV, initialized to correspond to the initial contours of the poly
// and its holes, and calculates all the initial events
StraightSkeleton.prototype.makeslav = function() {
  var slav = new Set();

  for (var i=0; i<this.entryHalfedges.length; i++) {
    var hestart = this.entryHalfedges[i];

    var lav = null;
    var lstart = null;

    this.edges = []; // todo: remove

    var he = hestart;
    do {
      // lav node, implicitly signifies vertex at start of given halfedge
      var lnode = this.lfactory.create(he);

      if (lav) {
        lnode.prev = lav;
        lav.next = lnode;
      }
      else lstart = lnode;

      lav = lnode;

      // necessary because halfedge is internal to the contour but iterating
      // forward after topology has changed might trap us in a subpolygon of
      // the halfedge data structure
      he = he.twin.prev().twin;
    } while (he != hestart);

    lav.next = lstart;
    lstart.prev = lav;

    var lcurr;

    // calculate forward and backward edges
    lcurr = lav;
    do {
      var edge = this.efactory.create(lcurr.he);
      lcurr.setEdgeForward(edge);
      lcurr.next.setEdgeBackward(edge);
      this.edges.push(edge); // todo: remove

      lcurr = lcurr.next;
    } while (lcurr != lav);

    // set reflex state
    lcurr = lav;
    do {
      this.calculateReflex(lcurr);

      lcurr = lcurr.next;
    } while (lcurr != lav);

    // calculate bisectors
    lcurr = lav;
    do {
      this.calculateBisector(lcurr);

      lcurr = lcurr.next;
    } while (lcurr != lav);

    slav.add(lav);
  }

  return slav;
}

StraightSkeleton.prototype.calculateReflex = function(lnode) {
  var ef = lnode.ef;
  var eb = lnode.eb;

  lnode.reflex = crossProductComponent(ef.forward, eb.backward, this.axis) < 0;
}

StraightSkeleton.prototype.calculateBisector = function(lnode) {
  var forward = lnode.ef.forward;
  var backward = lnode.eb.backward;
  var bisector = forward.clone().add(backward).normalize();

  if (lnode.reflex) bisector.negate();

  lnode.bisector = bisector;
}

// given a node in the lav, see which of its neighbors' bisectors it intersects
// first (if any)
StraightSkeleton.prototype.calculateEdgeEvent = function(event) {
  var axis = this.axis;

  var lnodeV = event.lnode;
  var v = lnodeV.v;
  var b = lnodeV.bisector;
  var lprev = lnodeV.prev;
  var vprev = lprev.v;
  var bprev = lprev.bisector;
  var lnext = lnodeV.next;
  var vnext = lnext.v;
  var bnext = lnext.bisector;

  var iprev = rayLineIntersection(v, vprev, b, bprev, axis);
  var inext = rayLineIntersection(v, vnext, b, bnext, axis);

  // 0 if no intersection; 1 if prev is closer; 2 if next is closer
  var intersectionResult = 0;
  if (iprev && inext) {
    // distances from the intersections to v
    var diprev = iprev.distanceTo(v);
    var dinext = inext.distanceTo(v);

    if (diprev < dinext) intersectionResult = 1;
    else intersectionResult = 2;
  }
  else if (iprev) intersectionResult = 1;
  else if (inext) intersectionResult = 2;

  if (intersectionResult == 1) {
    event.intersection = iprev;
    event.otherNode = lprev;
    var edge = lprev.ef;
    event.L = distanceToLine(iprev, edge.start, edge.end, axis);
  }
  // intersection with next bisector is closer
  else if (intersectionResult == 2) {
    event.intersection = inext;
    event.otherNode = lnext;
    var edge = lnodeV.ef;
    event.L = distanceToLine(inext, edge.start, edge.end, axis);
  }

  if (intersectionResult != 0) event.type = SSEventTypes.edgeEvent;
}

// calculates the closest split event caused by V's bisector (if V is reflex);
// if no split event, leave it alone
StraightSkeleton.prototype.calculateSplitEventSLAV = function(event, slav) {
  for (var lav of slav) {
    this.calculateSplitEvent(event, lav);
  }
}

StraightSkeleton.prototype.calculateSplitEvent = function(event, lav) {
  var lnodeV = event.lnode;

  if (!lnodeV.reflex) return;

  var v = lnodeV.v;
  var b = lnodeV.bisector;
  var axis = this.axis;
  var epsilon = this.epsilon;

  var splitPoint = null;
  // node that starts the edge that gets split
  var eventNode = null;
  var minL = Infinity;
  var splitType = 0;

  var lcurr = lav;
  do {
    // say current lnode is A and its next is B; we're considering the edge
    // between A and B through A and B
    var lnodeA = lcurr;
    var lnodeB = lcurr.next;

    lcurr = lcurr.next;

    // lnodeV's bisector will never split either of its incident edges
    if (lnodeA == lnodeV || lnodeB == lnodeV) continue;

    var ef = lnodeA.ef;
    var bA = lnodeA.bisector;
    var bB = lnodeB.bisector;

    var eAB = ef.forward;
    var vA = ef.start;
    var vB = ef.end;

    // the AB edge must "face" the splitting vertex - B left of VA segment
    if (!leftOn(v, vA, vB, axis, epsilon)) continue;

    // now say the forward and backward edges emanating from V intersect the
    // AB line at points R and S (R is closer); find R, draw its bisector with
    // AB line, see where it intersects V's bisector

    // edges emanating from V - *reverse* forward/backward edges, respectively
    var efnV = lnodeV.ef.backward;
    var ebnV = lnodeV.eb.forward;

    // pick the edge that's least parallel with the testing edge to avoid
    // the more parallel edge
    var fndotAB = Math.abs(efnV.dot(eAB));
    var bndotAB = Math.abs(ebnV.dot(eAB));
    var enV = (fndotAB < bndotAB) ? efnV : ebnV;

    // R is intersection point between the edge from V and the AB line
    var vR = lineLineIntersection(v, vA, enV, eAB, axis);

    if (vR === null) continue;

    // vector from R to V
    var eRV = v.clone().sub(vR).normalize();

    // need AB edge pointing from R toward the bisector
    if (left(v, v.clone().add(b), vR, axis)) eAB = ef.backward;

    // calculate bisector (not normalized) of AB line and RV vector
    var bRAB = eRV.add(eAB);

    // potential split event happens here
    var vSplit = rayLineIntersection(v, vR, b, bRAB, axis);

    if (vSplit === null) continue;

    // verify that the split event occurs within the area swept out by AB edge

    // A and A+A.bisector support the line that forms A's side of the edge's
    // sweep area; likewise for B
    var vAoffset = vA.clone().add(bA);
    var vBoffset = vB.clone().add(bB);

    // if the split point is coincident with one (or both) of the edge's
    // bisectors, then V's wavefront doesn't split the edge in two but instead
    // meets it at one (or both) of its ends - this is a special case of the
    // split event and has special handling
    var type = 0;
    if (collinear(vA, vAoffset, vSplit, axis, epsilon)) {
      type = type | SSEventTypes.startSplitEvent;
    }
    if (collinear(vB, vBoffset, vSplit, axis, epsilon)) {
      type = type | SSEventTypes.endSplitEvent;
    }

    // check if split point is on the "interior" side of the edge
    if (!left(vA, vB, vSplit, axis, epsilon)) continue;

    // if split point is not already known to be on one of the bisectors,
    // check if it's between the bisectors bounding the edge's sweep area
    if (type == 0) {
      if (left(vA, vAoffset, vSplit, axis, epsilon)) continue;
      if (left(vBoffset, vB, vSplit, axis, epsilon)) continue;
    }

    // valid split point, so see if it's the closest so far
    var L = distanceToLine(vSplit, vA, vB, axis);

    if (L < minL) {
      minL = L;
      splitPoint = vSplit;
      eventNode = lnodeA;
      splitType = type;
    }
  } while (lcurr != lav);

  // if the closest split event we found is closer than the edge event already
  // calculated for V, set V's event to split and set the appropriate fields
  if (minL < event.L) {
    event.type = SSEventTypes.splitEvent | splitType;
    event.L = minL;
    event.intersection = splitPoint;
    event.otherNode = eventNode;
  }
}

// given a set of LAVs, compute the initial events
StraightSkeleton.prototype.calculateInitialEvents = function(slav) {
  var pq = this.pq;

  for (var lav of slav) {
    var lnode = lav;
    do {
      var event = new SSEvent(lnode);

      this.calculateEdgeEvent(event);
      this.calculateSplitEventSLAV(event, slav);

      this.queueEvent(event);

      lnode = lnode.next;
    } while (lnode != lav);
  }
}
