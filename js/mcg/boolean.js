Object.assign(MCG.Boolean, (function() {

  var Boolean = {
    union: union
  };

  function union(a, b, dbg) {
    return MCG.Sweep.sweep(a, b, dbg);
  }


  return Boolean;

})());
