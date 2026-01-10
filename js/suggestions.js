// js/suggestions.js
export function initSuggestions() {
  console.log("✅ initSuggestions loaded");

  const btn = document.getElementById("submitSuggestionBtn");
  const input = document.getElementById("suggestionText");
  const note = document.getElementById("suggestionNote");

  if (!btn || !input) return;

  btn.onclick = () => {
    if (!input.value.trim()) {
      note.textContent = "Please enter a suggestion.";
      return;
    }

    note.textContent = "Suggestion submitted. Thanks!";
    input.value = "";
  };
}
