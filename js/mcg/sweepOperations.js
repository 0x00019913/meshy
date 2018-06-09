Object.assign(MCG.Sweep, (function() {

  // adds a new segment set to the result object with the given name
  function resultAddSet(result, context, name) {
    result[name] = new MCG.SegmentSet(context);

    return result;
  }

  // makes an object containing the init function and event handler
  function makeOperation(initResult, handleEvent) {
    return {
      initResult: initResult,
      handleEvent: handleEvent
    };
  }



  // operation result initialization functions

  function unionInit(context) {
    return resultAddSet({}, context, "union");
  }

  function intersectionInit(context) {
    return resultAddSet({}, context, "intersection");
  }

  function intersectionOpenInit(context) {
    return resultAddSet({}, context, "intersectionOpen");
  }

  function differenceInit(context) {
    return resultAddSet({}, context, "difference")
  }

  function fullDifferenceInit(context) {
    var result = {};

    resultAddSet(result, context, "AminusB");
    resultAddSet(result, context, "BminusA");
    resultAddSet(result, context, "intersection");

    return result;
  }



  // event handler functions

  function unionHandle(event, result) {
    var flags = MCG.Sweep.EventPositionFlags;
    var pos = event.getPosition();

    var inside = pos & flags.insideA || pos & flags.insideB;
    var boundaryA = pos & flags.boundaryA, boundaryB = pos & flags.boundaryB;
    var fromAtoB = pos & flags.fromAtoB;

    if (!inside && (boundaryA || boundaryB) && !fromAtoB) {
      event.addSegmentToSet(result.union);
    }
  }

  function intersectionHandle(event, result) {
    var flags = MCG.Sweep.EventPositionFlags;
    var pos = event.getPosition();

    var inside = pos & flags.insideA || pos & flags.insideB;
    var boundaryA = pos & flags.boundaryA, boundaryB = pos & flags.boundaryB;
    var boundaryAB = boundaryA && boundaryB;
    var fromAtoB = pos & flags.fromAtoB;

    if (boundaryAB && !fromAtoB) {
      event.addSegmentToSet(result.intersection);
    }
    else if (inside && (boundaryA || boundaryB)) {
      event.addSegmentToSet(result.intersection);
    }
  }

  function intersectionOpenHandle(event, result) {
    var flags = MCG.Sweep.EventPositionFlags;
    var pos = event.getPosition();

    var insideA = pos & flags.insideA;
    var isB = event.weightB !== 0;

    if (insideA && isB) {
      event.addSegmentToSet(result.intersectionOpen);
    }
  }

  function differenceHandle(event, result) {
    var flags = MCG.Sweep.EventPositionFlags;
    var pos = event.getPosition();

    var inside = pos & flags.insideA || pos & flags.insideB;
    var boundaryA = pos & flags.boundaryA, boundaryB = pos & flags.boundaryB;
    var boundaryAB = boundaryA && boundaryB;
    var fromAtoB = pos & flags.fromAtoB;

    if (boundaryAB) {
      if (fromAtoB) {
        event.addSegmentToSet(result.difference, false, event.weightA);
      }
    }
    else if (!inside && boundaryA) {
      event.addSegmentToSet(result.difference);
    }
    else if (inside && boundaryB) {
      event.addSegmentToSet(result.difference, true);
    }
  }

  function fullDifferenceHandle(event, result) {
    var flags = MCG.Sweep.EventPositionFlags;
    var pos = event.getPosition();

    var inside = pos & flags.insideA || pos & flags.insideB;
    var boundaryA = pos & flags.boundaryA, boundaryB = pos & flags.boundaryB;
    var boundaryAB = boundaryA && boundaryB;
    var fromAtoB = pos & flags.fromAtoB;

    if (boundaryAB) {
      if (fromAtoB) {
        event.addSegmentToSet(result.AminusB, false, event.weightA);
        event.addSegmentToSet(result.BminusA, false, event.weightB);
      }
      else {
        event.addSegmentToSet(result.intersection);
      }
    }
    else {
      if (!inside && boundaryA) {
        event.addSegmentToSet(result.AminusB);
      }
      if (inside && boundaryB) {
        event.addSegmentToSet(result.AminusB, true);
        event.addSegmentToSet(result.intersection);
      }
      if (!inside && boundaryB) {
        event.addSegmentToSet(result.BminusA);
      }
      if (inside && boundaryA) {
        event.addSegmentToSet(result.BminusA, true);
        event.addSegmentToSet(result.intersection);
      }
    }
  }



  var Operations = {
    union: makeOperation(unionInit, unionHandle),
    intersection: makeOperation(intersectionInit, intersectionHandle),
    intersectionOpen: makeOperation(intersectionOpenInit, intersectionOpenHandle),
    difference: makeOperation(differenceInit, differenceHandle),
    fullDifference: makeOperation(fullDifferenceInit, fullDifferenceHandle)
  };



  return {
    Operations: Operations
  };

})());
