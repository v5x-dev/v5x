import "./styles.css";
import { createComponent } from "solid-js";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { render } from "solid-js/web";
import { mount } from "svelte";
import { ReactDemo } from "./react/ReactDemo";
import { SolidDemo } from "./solid/SolidDemo";
import SvelteDemo from "./svelte/SvelteDemo.svelte";

const reactRoot = document.getElementById("react-root");
const svelteRoot = document.getElementById("svelte-root");
const solidRoot = document.getElementById("solid-root");

if (reactRoot === null || svelteRoot === null || solidRoot === null) {
  throw new Error("Example roots are missing from index.html.");
}

createRoot(reactRoot).render(createElement(ReactDemo));
mount(SvelteDemo, { target: svelteRoot });
render(() => createComponent(SolidDemo, {}), solidRoot);
