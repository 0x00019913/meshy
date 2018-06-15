Object.assign(MCG.Boolean, (function() {

  return {
    union: function(a, b, dbg) {
      return MCG.Sweep.sweep(MCG.Sweep.Operations.union(), a, b, dbg);
    },

    intersection: function(a, b, dbg) {
      var op = MCG.Sweep.Operations.intersection();
      var context = a.context;

      if (a.count() === 0 || b.count() === 0) return op.initResult(context);

      return MCG.Sweep.sweep(op, a, b, dbg);
    },

    intersectionOpen: function(a, b, dbg) {
      var op = MCG.Sweep.Operations.intersectionOpen();
      var context = a.context;

      if (a.count() === 0 || b.count() === 0) return op.initResult(context);

      return MCG.Sweep.sweep(op, a, b, dbg);
    },

    difference: function(a, b, dbg) {
      var op = MCG.Sweep.Operations.difference();
      var context = a.context;

      if (a.count() === 0) return op.initResult(context);
      if (b.count() === 0) return a;

      return MCG.Sweep.sweep(op, a, b, dbg);
    },

    fullDifference: function(a, b, dbg) {
      var op = MCG.Sweep.Operations.fullDifference();
      var context = a.context;

      if (a.count() === 0) {
        var result = op.initResult(context);
        result.BminusA = b;
        return result;
      }

      if (b.count() === 0) {
        var result = op.initResult(context);
        result.AminusB = a;
        return result;
      }

      return MCG.Sweep.sweep(op, a, b, dbg);
    }
  };

})());
