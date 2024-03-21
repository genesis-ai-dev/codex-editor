export const getTarget = ({ content }) => {
  const div = document.createElement("div");
  div.innerHTML = content;

  const { target } = div.firstChild?.dataset || {};

  return target;
};
