import { Link } from "react-router-dom";
import { GithubIcon } from "./icons/GithubIcon";
import { HelpCircleIcon } from "./icons/HelpCircleIcon";
import { FileTextIcon } from "./icons/FileTextIcon";

// Static Discord avatar for the byline below - deliberately not tied to
// whoever is currently logged in, so it always shows voxxtelum's own
// avatar regardless of who's viewing the page.
const BYLINE_AVATAR =
  "https://cdn.discordapp.com/avatars/208225417067364353/d71f6a7848d424a299e3efc75893fd74.png";

export function GlobalFooter() {
  return (
    <footer className="card global-footer">
      <span className="global-footer-byline">
        <span>by</span>
        <span className="global-footer-byline-identity">
          <img
            className="user-avatar"
            src={BYLINE_AVATAR}
            alt=""
            width={20}
            height={20}
          />
          <span className="global-footer-byline-name">voxxtelum</span>
        </span>
        <span>(Goobygoobydo-OldBlanchy)</span>
      </span>
      <nav className="global-footer-links">
        <a
          href="https://github.com/voxxtelum/warrior-market"
          target="_blank"
          rel="noopener noreferrer"
          className="text-link text-link-accent"
        >
          <GithubIcon className="icon-btn-icon" />
          GitHub
        </a>
        <Link to="/faq" className="text-link text-link-accent">
          <HelpCircleIcon className="icon-btn-icon" />
          FAQ
        </Link>
        <Link to="/documentation" className="text-link text-link-accent">
          <FileTextIcon className="icon-btn-icon" />
          Documentation
        </Link>
      </nav>
    </footer>
  );
}
