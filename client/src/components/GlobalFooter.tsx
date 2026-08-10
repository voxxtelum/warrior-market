import { Link } from "react-router-dom";
import { GithubIcon } from "./icons/GithubIcon";
import { HelpCircleIcon } from "./icons/HelpCircleIcon";
import { FileTextIcon } from "./icons/FileTextIcon";

export function GlobalFooter() {
  return (
    <footer className="card global-footer">
      <span className="global-footer-byline">
        by @voxxtelum (Goobygoobydo-OldBlanchy)
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
