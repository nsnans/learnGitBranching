var Backbone = require('backbone');
const {getAllCommands} = require('../sandbox/commands');

var Main = require('../app');
var CommandLineStore = require('../stores/CommandLineStore');
var CommandLineActions = require('../actions/CommandLineActions');

var log = require('../log');
var keyboard = require('../util/keyboard');

const allCommands = Object.keys(getAllCommands());
// Lets push a few commands up in the suggestion order,
// which overrides the order from the exportj
const autoCompleteSuggestionOrder = [
  'levels', // above "level"
  'help', // above help level since you might not be in a level
  'show solution', // above show goal since you start with a goal view
  'reset', // over reset solved
  'import level', // over import tree
  // for the git commands, we did an analysis and got a better order.
  // That way cherry pick is not before checkout
  "git commit",
  "git clone",
  "git fakeTeamwork",
  "git checkout",
  "git branch",
  "git fetch",
  "git pull",
];

const allCommandsSorted = autoCompleteSuggestionOrder.concat(
  // add the rest that arent in the list above
  allCommands.map(command => autoCompleteSuggestionOrder.indexOf(command) > 0 ? null : command)
  .filter(command => !!command)
);

var CommandPromptView = Backbone.View.extend({
  initialize: function() {
    Main.getEvents().on('commandSubmittedPassive', this.addToCommandHistory, this);

    this.index = -1;
    this.commandParagraph = this.$('#prompt p.command')[0];
    this.focus();

    Main.getEvents().on('rollupCommands', this.rollupCommands, this);

    Main.getEventBaton().stealBaton('keydown', this.onKeyDown, this);
    Main.getEventBaton().stealBaton('keyup', this.onKeyUp, this);
    this.updatePrompt(" ");
  },

  events: {
    'blur #commandTextField': 'hideCursor',
    'focus #commandTextField': 'showCursor'
  },

  blur: function() {
    this.hideCursor();
  },

  focus: function() {
    this.$('#commandTextField').focus();
    this.showCursor();
  },

  hideCursor: function() {
    this.toggleCursor(false);
  },

  showCursor: function() {
    this.toggleCursor(true);
  },

  toggleCursor: function(state) {
    $(this.commandParagraph).toggleClass('showCursor', state);
  },

  onKeyDown: function(e) {
    var el = e.target;

    const shadowEl = document.querySelector('#shadow');

    const currentValue = el.value;
    const allCommand = currentValue.split(';');
    const lastCommand = allCommand[allCommand.length - 1]
      .replace(/\s\s+/g, ' ').replace(/^\s/, '');

    shadowEl.innerHTML = '';
    if (lastCommand.length) {
      for (const c of allCommandsSorted) {
        if (c.startsWith(lastCommand)) {
          shadowEl.innerHTML = (currentValue + c.replace(lastCommand, '')).replace(/ /g, '&nbsp;');
          break;
        }
      }
    }

    if (e.keyCode === 9) {
      e.preventDefault();
      if (shadowEl.innerHTML) {
        el.value = shadowEl.innerHTML.replace(/&nbsp;/g, ' ');
      }
    }

    // lets also handle control + U to clear the line
    if (e.keyCode === 85 && e.ctrlKey && e.type === 'keydown') {
      e.preventDefault();
      el.value = '';
      el.selectionStart = el.selectionEnd = 0;
    }

     // handle control + W to delete up to previous word
    const isDeleteWord = (
      e.keyCode === 87 && e.ctrlKey && e.type === 'keydown'
    ) || (
      // handle alt + backspace to delete up to previous word
      e.keyCode === 8 && e.altKey && e.type === 'keydown'
    );
    if (isDeleteWord) {
      e.preventDefault();
      const cursorPos = el.selectionStart;
      const textBeforeCursor = el.value.substring(0, cursorPos);
      // Find the last word boundary
      const lastSpaceIndex = textBeforeCursor.trimEnd().lastIndexOf(' ');
      if (lastSpaceIndex >= 0) {
        el.value = el.value.substring(0, lastSpaceIndex + 1) + 
                  el.value.substring(cursorPos);
        el.selectionStart = el.selectionEnd = lastSpaceIndex + 1;
      } else {
        // If no space found, clear to start
        el.value = el.value.substring(cursorPos);
        el.selectionStart = el.selectionEnd = 0;
      }
    }
    this.updatePrompt(el);
  },

  onKeyUp: function(e) {
    this.onKeyDown(e);

    // we need to capture some of these events.
    var keyToFuncMap = {
      enter: function() {
        this.submit();
      }.bind(this),
      up: function() {
        this.commandSelectChange(1);
      }.bind(this),
      down: function() {
        this.commandSelectChange(-1);
      }.bind(this)
    };

    var key = keyboard.mapKeycodeToKey(e.which || e.keyCode);
    if (keyToFuncMap[key] !== undefined) {
      e.preventDefault();
      keyToFuncMap[key]();
      this.onKeyDown(e);
    }
  },

  badHtmlEncode: function(text) {
    return text.replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/</g,'&lt;')
      .replace(/ /g,'&nbsp;')
      .replace(/\n/g,'');
  },

  updatePrompt: function(el) {
    el = el || {};  // firefox
    // i WEEEPPPPPPpppppppppppp that this reflow takes so long. it adds this
    // super annoying delay to every keystroke... I have tried everything
    // to make this more performant. getting the srcElement from the event,
    // getting the value directly from the dom, etc etc. yet still,
    // there's a very annoying and sightly noticeable command delay.
    // try.github.com also has this, so I'm assuming those engineers gave up as
    // well...
    var text = $('#commandTextField').val();

    // Alright so we have our initial value for what we want the
    // command line to contain. We need to next split into the
    // parse with the cursor and without
    var selectionStart = el.selectionStart;
    var selectionEnd = el.selectionEnd;
    if (!text.length) {
      text = ' ';
      selectionStart = 0;
      selectionEnd = 1;
    } else if (selectionStart === selectionEnd) {
      // Lets pretend they have selected the end character to make the cursor
      // shown
      text += ' ';
      selectionEnd += 1;
    } else if (selectionStart === undefined || selectionEnd === undefined) {
      // I donno what this is for
      selectionStart = Math.max(text.length - 1, 0);
      selectionEnd = text.length;
    }

    var before = text.substring(0, selectionStart);
    var middle = text.substring(selectionStart, selectionEnd);
    var end = text.substring(selectionEnd, text.length);

    // Then just make three spans and slap it in.
    var finalHTML = '<span>' + this.badHtmlEncode(before) + '</span>' +
      '<span class="commandCursor">' + this.badHtmlEncode(middle) + '</span>' +
      '<span>' + this.badHtmlEncode(end) + '</span>';
    this.commandParagraph.innerHTML = finalHTML;
    // and scroll down due to some weird bug
    Main.getEvents().trigger('commandScrollDown');
  },

  commandSelectChange: function(delta) {
    this.index += delta;

    // if we are over / under, display blank line. yes this eliminates your
    // partially edited command, but i doubt that is much in this demo
    if (this.index >= CommandLineStore.getCommandHistoryLength() || this.index < 0) {
      this.clear();
      this.index = -1;
      return;
    }

    // yay! we actually can display something
    var commandEntry = CommandLineStore.getCommandHistory()[this.index];
    this.setTextField(commandEntry);
  },

  setTextField: function(value) {
    this.$('#commandTextField').val(value);
  },

  clear: function() {
    this.setTextField('');
  },

  submit: function() {
    var value = this.$('#commandTextField').val().replace('\n', '');
    this.clear();

    this.submitCommand(value);
    this.index = -1;
  },

  rollupCommands: function(numBack) {
    var which = CommandLineStore.getCommandHistory().slice(1, Number(numBack) + 1);
    which.reverse();

    var str = '';
    which.forEach(function(text) {
      str += text + ';';
    }, this);

    CommandLineActions.submitCommand(str);
  },

  addToCommandHistory: function(value) {
    // we should add the command to our local storage history
    // if it's not a blank line and this is a new command...
    // or if we edited the command in place in history
    var shouldAdd = (value.length && this.index === -1) ||
      ((value.length && this.index !== -1 &&
      CommandLineStore.getCommandHistory()[this.index] !== value));

    if (!shouldAdd) {
      return;
    }

    CommandLineActions.submitCommand(value);
    log.commandEntered(value);
  },

  submitCommand: function(value) {
    Main.getEventBaton().trigger('commandSubmitted', value);
  }
});

exports.CommandPromptView = CommandPromptView;
