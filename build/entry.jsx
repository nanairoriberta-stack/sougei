import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app.jsx";
class Guard extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) return React.createElement("div", { style: { padding: 24, fontFamily: "sans-serif", color: "#9f1239" } },
      React.createElement("p", { style: { fontWeight: 700 } }, "画面を表示できませんでした"),
      React.createElement("p", null, String(this.state.err && this.state.err.message || this.state.err)),
      React.createElement("p", null, "入力済みの未送信データは端末に保存されています。再読み込みしてください。"),
      React.createElement("button", { onClick: () => location.reload(), style: { padding: "6px 14px", border: "1px solid #ccc", borderRadius: 6 } }, "再読み込み"));
    return this.props.children;
  }
}
createRoot(document.getElementById("root")).render(React.createElement(Guard, null, React.createElement(App)));
