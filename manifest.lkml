
project_name: "looker-extension-viz-filter"

application: looker-extension-viz-filter {
  label: "looker-extension-viz-filter"
  url: "https://localhost:8080/bundle.js"
  # file: "bundle.js"
  entitlements: {
    use_embeds: yes
    core_api_methods: ["query","create_query"]
  }
  mount_points: {
    dashboard_vis: yes
    dashboard_tile: yes
    standalone: no
  }
}
