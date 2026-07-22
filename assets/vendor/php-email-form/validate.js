/**
 * Contact form submit handler (based on BootstrapMade php-email-form v3.11)
 * Surfaces server error bodies so users see clear messages, not "400 URL".
 */
(function () {
  "use strict";

  var forms = document.querySelectorAll(".php-email-form");

  forms.forEach(function (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var thisForm = this;
      var action = thisForm.getAttribute("action");
      var recaptcha = thisForm.getAttribute("data-recaptcha-site-key");

      if (!action) {
        displayError(thisForm, "Something went wrong with the form. Please email hello@getworkingwithai.com.");
        return;
      }

      clearStatus(thisForm);

      // Client-side checks before network (clearer + faster feedback)
      var clientError = validateClient(thisForm);
      if (clientError) {
        displayError(thisForm, clientError);
        return;
      }

      thisForm.querySelector(".loading").classList.add("d-block");

      var formData = new FormData(thisForm);

      if (recaptcha) {
        if (typeof grecaptcha !== "undefined") {
          grecaptcha.ready(function () {
            try {
              grecaptcha
                .execute(recaptcha, { action: "php_email_form_submit" })
                .then(function (token) {
                  formData.set("recaptcha-response", token);
                  submitForm(thisForm, action, formData);
                })
                .catch(function () {
                  displayError(
                    thisForm,
                    "Security check failed. Please refresh the page and try again, or email hello@getworkingwithai.com."
                  );
                });
            } catch (error) {
              displayError(
                thisForm,
                "Security check failed. Please refresh the page and try again, or email hello@getworkingwithai.com."
              );
            }
          });
        } else {
          displayError(
            thisForm,
            "Security check could not load. Please refresh the page, or email hello@getworkingwithai.com."
          );
        }
      } else {
        submitForm(thisForm, action, formData);
      }
    });
  });

  function validateClient(form) {
    var name = (form.querySelector('[name="name"]') || {}).value || "";
    var email = (form.querySelector('[name="email"]') || {}).value || "";
    var subject = (form.querySelector('[name="subject"]') || {}).value || "";
    var message = (form.querySelector('[name="message"]') || {}).value || "";

    name = name.trim();
    email = email.trim();
    subject = subject.trim();
    message = message.trim();

    if (!name) return "Please enter your full name.";
    if (!email) return "Please enter your email address.";
    if (!isValidEmail(email)) return "That email address does not look valid. Please check it and try again.";
    if (!subject) return "Please enter your company or organisation.";
    if (!message) return "Please write your question before sending.";
    if (message.length > 4000) return "Your question is a bit long (max 4,000 characters). Please shorten it and try again.";

    // Managed Turnstile injects cf-turnstile-response; require it when the widget is present
    if (form.querySelector(".cf-turnstile")) {
      var tokenInput = form.querySelector('[name="cf-turnstile-response"]');
      var token = tokenInput && tokenInput.value ? tokenInput.value.trim() : "";
      if (!token) {
        return "Please complete the security check and try again.";
      }
    }

    return null;
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function submitForm(thisForm, action, formData) {
    fetch(action, {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    })
      .then(function (response) {
        return response.text().then(function (body) {
          return { ok: response.ok, status: response.status, body: (body || "").trim() };
        });
      })
      .then(function (result) {
        thisForm.querySelector(".loading").classList.remove("d-block");

        if (result.ok && result.body === "OK") {
          thisForm.querySelector(".sent-message").classList.add("d-block");
          thisForm.reset();
          resetTurnstile(thisForm);
          return;
        }

        resetTurnstile(thisForm);
        displayError(thisForm, friendlyServerMessage(result));
      })
      .catch(function () {
        resetTurnstile(thisForm);
        displayError(
          thisForm,
          "We could not reach the server. Check your connection and try again, or email hello@getworkingwithai.com."
        );
      });
  }

  function resetTurnstile(form) {
    if (typeof turnstile === "undefined" || !form) return;
    var widgets = form.querySelectorAll(".cf-turnstile");
    widgets.forEach(function (el) {
      try {
        turnstile.reset(el);
      } catch (e) {
        /* ignore if widget not ready */
      }
    });
  }

  function friendlyServerMessage(result) {
    var body = result.body;

    // Prefer plain-language body from the Worker when present
    if (body && body !== "OK" && !looksLikeTechnicalError(body)) {
      return body;
    }

    if (result.status === 400) {
      return "Please check your details and try again. Name, a valid email, and your question are required.";
    }
    if (result.status === 403) {
      return body && !looksLikeTechnicalError(body)
        ? body
        : "Security check failed. Please refresh the page and try again, or email hello@getworkingwithai.com.";
    }
    if (result.status === 429) {
      return "Too many messages in a short time. Please wait a minute and try again.";
    }
    if (result.status === 502 || result.status === 503) {
      return "We could not deliver your message right now. Please email hello@getworkingwithai.com and we will get back to you.";
    }
    if (result.status >= 500) {
      return "Something went wrong on our side. Please try again in a moment, or email hello@getworkingwithai.com.";
    }

    return "Your message could not be sent. Please try again, or email hello@getworkingwithai.com.";
  }

  function looksLikeTechnicalError(text) {
    return (
      /Content-Type/i.test(text) ||
      /FormData/i.test(text) ||
      /^Error:/i.test(text) ||
      /\bhttps?:\/\//i.test(text) ||
      /^\d{3}\s/.test(text)
    );
  }

  function clearStatus(thisForm) {
    var loading = thisForm.querySelector(".loading");
    var err = thisForm.querySelector(".error-message");
    var sent = thisForm.querySelector(".sent-message");
    if (loading) loading.classList.remove("d-block");
    if (err) {
      err.classList.remove("d-block");
      err.textContent = "";
    }
    if (sent) sent.classList.remove("d-block");
  }

  function displayError(thisForm, error) {
    var loading = thisForm.querySelector(".loading");
    var errEl = thisForm.querySelector(".error-message");
    if (loading) loading.classList.remove("d-block");
    if (!errEl) return;

    var message =
      typeof error === "string"
        ? error
        : error && error.message
          ? error.message
          : "Something went wrong. Please try again, or email hello@getworkingwithai.com.";

    // textContent avoids injecting raw HTML from any error string
    errEl.textContent = message;
    errEl.classList.add("d-block");
  }
})();
