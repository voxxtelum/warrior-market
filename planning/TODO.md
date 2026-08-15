I want to add a new pop up window that serves a notification to users of a new feature

This should be configurable in the app, in the Admin route, in a tab called Notifications between Price History and Audit Log

Like the current notifications for adding/removing coins to user wallet, I want the notifications to be tracked so that a user only sees it once.

One caveat: I only want one notification to be active at a time. I would like the ability to create more, but only one is ever shown to users at a time. By default, notifications should be inactive.

In the new Notifications tab, there should be a table listing the notifications, similar to the Manage Funds tab. I like the UX of this tab, and I would like to have basic CRUD functionality for the notifications like the funds, and the import/export feature.

Each notification should also have a name, and an affirmative button at the bottom that links to a page on the site that I can select. For example, if I wanted to create a notification for the new Funds feature, there should be a button at the bottom (with editable text - so it says Start Trading) that I can set to link to the market/funds page. Obviously all admin routes are excluded, only public routes

As for the content in the modal, I would really like to have a basic WYSIWYG editor, with the ability to add small images. (basic font styling, colors, alignment, sizes, etc)

I would also like the ability to test a notification from the notifications table, so that it just shows the modal but does not track a viewed state. This is just for testing purposes and previewing the notification.
