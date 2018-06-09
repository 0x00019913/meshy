Object.assign(MCG.Boolean, (function() {

  return {
    union: function(a, b, dbg) {
      return MCG.Sweep.sweep(MCG.Sweep.Operations.union, a, b, dbg);
    },

    intersection: function(a, b, dbg) {
      return MCG.Sweep.sweep(MCG.Sweep.Operations.intersection, a, b, dbg);
    },

    intersectionOpen: function(a, b, dbg) {
      return MCG.Sweep.sweep(MCG.Sweep.Operations.intersectionOpen, a, b, dbg);
    },

    difference: function(a, b, dbg) {
      return MCG.Sweep.sweep(MCG.Sweep.Operations.difference, a, b, dbg);
    },

    fullDifference: function(a, b, dbg) {
      return MCG.Sweep.sweep(MCG.Sweep.Operations.fullDifference, a, b, dbg);
    }
  };

})());
