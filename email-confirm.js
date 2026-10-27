(function () {
    "use strict";

    var allowNextSubmit = false;
    var pendingForm = null;

    function addStyles() {
        var style = document.createElement("style");
        style.textContent = [
            ".confirm-overlay{position:fixed;inset:0;background:rgba(17,24,39,.35);display:flex;align-items:center;justify-content:center;padding:20px;z-index:9999}",
            ".confirm-card{width:min(440px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.18);padding:22px}",
            ".confirm-title{margin:0 0 8px;font-size:18px;font-weight:700;color:#111827}",
            ".confirm-message{margin:0;color:#4b5563;font-size:14px;line-height:1.5}",
            ".confirm-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}",
            ".confirm-actions button{border:0;border-radius:8px;padding:10px 16px;font:inherit;font-weight:650;cursor:pointer}",
            ".confirm-cancel{background:#eef2f7;color:#374151}",
            ".confirm-send{background:#2563eb;color:#fff}"
        ].join("");
        document.head.appendChild(style);
    }

    function currentModeLabel() {
        var mode = document.getElementById("send-mode");
        var template = document.getElementById("template-select");
        if (mode && mode.value === "template") {
            if (template && template.selectedIndex >= 0) {
                var option = template.options[template.selectedIndex];
                if (option && option.value) {
                    return " using the CRM template “" + option.textContent + "”";
                }
            }
            return " using the selected CRM template";
        }
        return "";
    }

    function recipientCount() {
        var summary = document.getElementById("recipient-summary");
        var text = summary ? String(summary.textContent || "") : "";
        var match = text.match(/^(\d+)\s+unique email/);
        return match ? Number(match[1]) : 0;
    }

    function showConfirmation(form) {
        var existing = document.getElementById("send-confirm-overlay");
        if (existing) {
            existing.remove();
        }

        var count = recipientCount();
        var overlay = document.createElement("div");
        overlay.id = "send-confirm-overlay";
        overlay.className = "confirm-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");

        var card = document.createElement("div");
        card.className = "confirm-card";

        var title = document.createElement("h2");
        title.className = "confirm-title";
        title.textContent = "Confirm email send";

        var message = document.createElement("p");
        message.className = "confirm-message";
        message.textContent = "Send this email to " + count + " unique registered attendee email" + (count === 1 ? "" : "s") + currentModeLabel() + "?";

        var actions = document.createElement("div");
        actions.className = "confirm-actions";

        var cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "confirm-cancel";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", function () {
            overlay.remove();
        });

        var send = document.createElement("button");
        send.type = "button";
        send.className = "confirm-send";
        send.textContent = "Send Now";
        send.addEventListener("click", function () {
            overlay.remove();
            allowNextSubmit = true;
            pendingForm = form;
            form.requestSubmit();
        });

        actions.appendChild(cancel);
        actions.appendChild(send);
        card.appendChild(title);
        card.appendChild(message);
        card.appendChild(actions);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        send.focus();
    }

    document.addEventListener("DOMContentLoaded", function () {
        addStyles();
        var form = document.getElementById("email-form");
        if (!form) {
            return;
        }

        form.addEventListener("submit", function (event) {
            if (allowNextSubmit && pendingForm === form) {
                allowNextSubmit = false;
                pendingForm = null;
                window.confirm = function () { return true; };
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();
            showConfirmation(form);
        }, true);
    });
}());
