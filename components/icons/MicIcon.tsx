
import React from 'react';

const MicIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z" />
    <path d="M19 10v1a7 7 0 01-14 0v-1h2v1a5 5 0 0010 0v-1h2z" />
    <path d="M12 19a2 2 0 01-2-2v-2H8v2a4 4 0 008 0v-2h-2v2a2 2 0 01-2 2z" />
  </svg>
);

export default MicIcon;
