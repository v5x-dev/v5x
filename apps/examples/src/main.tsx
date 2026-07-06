import "./styles.css";
import { createComponent } from "solid-js";
import { createRoot } from "react-dom/client";
import { render } from "solid-js/web";
import { mount } from "svelte";
import { ReactDemo } from "./react/ReactDemo";
import { SolidDemo } from "./solid/SolidDemo";
import SvelteDemo from "./svelte/SvelteDemo.svelte";

function root(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing #${id} in index.html.`);
  return element;
}

createRoot(root("react-root")).render(<ReactDemo />);
mount(SvelteDemo, { target: root("svelte-root") });
render(() => createComponent(SolidDemo, {}), root("solid-root"));
