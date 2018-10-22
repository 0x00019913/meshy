// infoBox.js
// classes:
//  InfoBox
// description:
//  Hangs out in the corner and provides information.
//
//  Usage:
//   // for non-manual data
//   var box = new InfoBox();
//   box.add(title, source, props, def;
//   box.update(); // called manually to update the values in the box
//
//  Arguments for .add:
//   -title: title for the line in the info box
//   -source: closest unchanging reference to the requisite property
//   -props: a single property name, or an array of property names, that
//     lead to the data source
//   -def: default value if the line needs to be calculated
//
//  Prop names that are functions are called instead of dereferenced,
//   but this can be expensive.
//
//  Examples:
//   -If the requisite property is one reference away from the source, do:
//     box.add("foo", this, "count"); // or box.add("foo", this, ["count"]);
//   Then the value displayed will be this.count.
//   -If the datum comes from this.model.count, and model is not guaranteed
//   to reference the same object, then .add is called like:
//     box.add("foo", this, ["model", "count"]);
//   When calling .update(), the value displayed in the infobox will show
//   the value of this.model.count.


var InfoBox = (function() {

  // container for info lists
  function InfoBox(domElement, decimals) {
    domElement = domElement || document;

    this.container = document.createElement("div");
    this.container.id = "infoBox"
    //this.styleContainer();
    document.body.appendChild(this.container);

    this.lists = {};

    this.addList("default");

    this.decimals = decimals !== undefined ? decimals : 4;
  }

  Object.assign(InfoBox.prototype, {

    // update all lists
    update: function() {
      for (var listName in this.lists) {
        this.lists[listName].update();
      }
    },

    // add a list to the InfoBox
    addList: function(name, title, color) {
      if (this.lists.hasOwnProperty(name)) return null;

      var list = new InfoList(name, title, color);

      list.parent = this;
      this.lists[name] = list;
      this.container.appendChild(list.container);

      return list;
    },

    // remove a list from the InfoBox
    removeList: function(list) {
      // never remove the default list
      if (list.name === "default") return;

      // do nothing if the list isn't in the box
      if (!this.lists.hasOwnProperty(list.name)) return;

      // remove the HTML node
      this.container.removeChild(list.container);

      // remove the lists entry
      delete this.lists[list.name];
    },

    // adding a line to the InfoBox adds it to the default list
    add: function(title, source, props, def) {
      this.lists.default.add(title, source, props, def);
    },

    // Style the div container.
    styleContainer: function() {
      this.container.style.position = "absolute";
      this.container.style.left = "0";
      this.container.style.top = "0";
      this.container.style.width = "255px";
      this.container.style.marginLeft = "15px";
      this.container.style.backgroundColor = "#000";
      this.container.style.overflowY = "auto";
      this.container.style.maxHeight = "100%";

      this.container.style.color = "#eee";
      this.container.style.font = "11px Lucida Grande, sans-serif";
      this.container.style.textShadow = "0 -1px 0 #111";
    }

  });



  // a list that goes into the InfoBox
  function InfoList(name, title, color) {
    if (name === undefined || name === null) return;

    this.name = name;

    this.container = document.createElement("div");
    this.container.className = "listContainer";
    //this.styleContainer(color);
    if (color !== undefined) this.container.style.border = "1px solid #" + color.toString(16);

    if (title !== undefined && title !== "default") {
      this.title = document.createElement("div");
      this.title.textContent = title;
      this.title.className = "listTitle";
      //this.styleTitle();
      this.container.appendChild(this.title);
    }

    this.ul = document.createElement("ul");
    this.container.appendChild(this.ul);
    this.ul.className = "listUL";
    //this.styleUL();

    this.items = [];
  }

  Object.assign(InfoList.prototype, {
    // Add a line.
    add: function(title, source, props, def) {
      var liValueElement = this.createLine(title);

      if (!isArray(props)){
        props = [props];
      }

      this.items.push({
        value: liValueElement,
        source: source,
        props: props,
        def: def
      });
    },

    // Creates a line in the InfoList, returns HTML element that contains the value.
    createLine: function(title) {
      var li = document.createElement("li");
      li.className = "listLI";
      //this.styleLI(li);

      var liTitle = document.createElement("span");
      liTitle.className = "listLITitle";
      //this.styleLITitle(liTitle);
      var liTitleText = document.createTextNode(title);
      liTitle.appendChild(liTitleText);

      li.appendChild(liTitle);

      var liValue = document.createElement("span");
      liValue.className = "listLIValue";
      //this.styleLIValue(liValue);

      li.appendChild(liValue);

      this.ul.appendChild(li);

      return liValue;
    },

    // Update the gettable values.
    update: function() {
      for (var itemIdx=0; itemIdx<this.items.length; itemIdx++) {
        var item = this.items[itemIdx];

        if (!item.source) {
          item.value.textContent = "";
          continue;
        }

        var value = this.getPropValue(item.source, item.props);

        if (value==="" && item.def) value = item.def;

        item.value.textContent = value;
      }
    },

    // Format numerical quantities; if int, return as-is.
    formatNumber: function(num) {
      if ((num%1)===0) return num;
      else return +num.toFixed(this.parent.decimals);
    },

    // Get the value of a prop as mapped through .add or .addMultiple.
    getPropValue: function(source, propPath) {
      for (var i=0; i<propPath.length; i++) {
        if (isFunction(source[propPath[i]])) source = source[propPath[i]]();
        else source = source[propPath[i]];
        if (source===null || source===undefined) return "";
      }
      var value;

      if (isNumber(source)) value = this.formatNumber(source);
      else if (source.isVector2) {
        value = "[";
        value += this.formatNumber(source.x);
        value += ", ";
        value += this.formatNumber(source.y);
        value += "]";
      }
      else if (source.isVector3) {
        value = "[";
        value += this.formatNumber(source.x);
        value += ", ";
        value += this.formatNumber(source.y);
        value += ", ";
        value += this.formatNumber(source.z);
        value += "]";
      }
      else value = source;

      return value;
    },

    styleContainer: function(color) {
      this.container.style.boxSizing = "border-box";
      this.container.style.width = "100%";
      this.container.style.height = "auto";
      this.container.style.margin = "2px 0";
      this.container.style.padding = "0 6px";
      if (color !== undefined) this.container.style.border = "1px solid #" + color.toString(16);
    },

    styleTitle: function() {
      this.title.style.padding = "8px 0";
      this.title.style.borderBottom = "solid 1px #222";
      this.title.style.fontWeight = "bold";
    },

    styleUL: function() {
      this.ul.style.width = "100%";
      this.ul.style.height = "auto";
      this.ul.style.margin = "0";
      this.ul.style.padding = "0";
    },

    // Style list item.
    styleLI: function(listItem) {
      listItem.style.width = "100%";
      listItem.style.minHeight = "21px";
      listItem.style.overflow = "hidden";
      listItem.style.paddingTop = "5px";
    },

    // Style the span containing the title of a list item.
    styleLITitle: function(listItemTitle) {
      listItemTitle.style.width = "40%";
      listItemTitle.style.overflow = "hidden";
      listItemTitle.style.textOverflow = "ellipsis";
      listItemTitle.style.display = "inline-block";
      listItemTitle.style.verticalAlign = "top";
    },

    // Style the span containing the value of a list item.
    styleLIValue: function(listItemTitle) {
      listItemTitle.style.width = "60%";
      listItemTitle.style.overflow = "hidden";
      listItemTitle.style.textOverflow = "ellipsis";
      listItemTitle.style.display = "inline-block";
    }

  });

  return InfoBox;

})();
