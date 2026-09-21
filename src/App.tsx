"use client"

import { Command, FolderKanban, Home, ListChecks, PanelLeft, Presentation, Route, SquareDashed } from "lucide-react"
import { useState } from "react"
import {
  AnimatedSidebar,
  AnimatedSidebarContent,
  AnimatedSidebarFooter,
  AnimatedSidebarGroup,
  AnimatedSidebarGroupContent,
  AnimatedSidebarHeader,
  AnimatedSidebarInset,
  AnimatedSidebarMenu,
  AnimatedSidebarMenuButton,
  AnimatedSidebarMenuItem,
  AnimatedSidebarProvider,
  AnimatedSidebarRail,
  AnimatedSidebarTrigger,
} from "@/components/motion/animated-sidebar"
import { FooterSettings } from "@/components/footer-settings"
import { ThemeProvider } from "@/lib/theme-context"

export default function App() {
  const [active, setActive] = useState("Home")

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground">
        <AnimatedSidebarProvider className="min-h-screen bg-background">
          <AnimatedSidebar collapsible="icon" ariaLabel="SmartLearn navigation">
            <AnimatedSidebarHeader>
              <div className="flex min-h-11 items-center gap-3 overflow-hidden px-2">
                <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <Command aria-hidden="true" className="size-4" />
                </div>
                <span className="truncate text-sm font-semibold group-data-[state=collapsed]/sidebar:hidden">
                  SmartLearn
                </span>
              </div>
            </AnimatedSidebarHeader>

            <AnimatedSidebarContent>
              <AnimatedSidebarGroup>
                <AnimatedSidebarGroupContent>
                  <AnimatedSidebarMenu>
                    <AnimatedSidebarMenuItem>
                      <AnimatedSidebarMenuButton
                        icon={<Home className="size-4" />}
                        isActive={active === "Home"}
                        onSelect={() => setActive("Home")}
                        className="text-[15px]"
                      >
                        Home
                      </AnimatedSidebarMenuButton>
                    </AnimatedSidebarMenuItem>
                    <AnimatedSidebarMenuItem>
                      <AnimatedSidebarMenuButton
                        icon={<SquareDashed className="size-4" />}
                        isActive={active === "Dashboard"}
                        onSelect={() => setActive("Dashboard")}
                        className="text-[15px]"
                      >
                        Dashboard
                      </AnimatedSidebarMenuButton>
                    </AnimatedSidebarMenuItem>
                    <AnimatedSidebarMenuItem>
                      <AnimatedSidebarMenuButton
                        icon={<Route className="size-4" />}
                        isActive={active === "Roadmap"}
                        onSelect={() => setActive("Roadmap")}
                        className="text-[15px]"
                      >
                        Roadmap
                      </AnimatedSidebarMenuButton>
                    </AnimatedSidebarMenuItem>
                    <AnimatedSidebarMenuItem>
                      <AnimatedSidebarMenuButton
                        icon={<Presentation className="size-4" />}
                        isActive={active === "Slides"}
                        onSelect={() => setActive("Slides")}
                        className="text-[15px]"
                      >
                        Slides
                      </AnimatedSidebarMenuButton>
                    </AnimatedSidebarMenuItem>
                    <AnimatedSidebarMenuItem>
                      <AnimatedSidebarMenuButton
                        icon={<FolderKanban className="size-4" />}
                        isActive={active === "Projects"}
                        onSelect={() => setActive("Projects")}
                        className="text-[15px]"
                      >
                        Projects
                      </AnimatedSidebarMenuButton>
                    </AnimatedSidebarMenuItem>
                    <AnimatedSidebarMenuItem>
                      <AnimatedSidebarMenuButton
                        icon={<ListChecks className="size-4" />}
                        isActive={active === "Quizzes"}
                        onSelect={() => setActive("Quizzes")}
                        className="text-[15px]"
                      >
                        Quizzes
                      </AnimatedSidebarMenuButton>
                    </AnimatedSidebarMenuItem>
                  </AnimatedSidebarMenu>
                </AnimatedSidebarGroupContent>
              </AnimatedSidebarGroup>
            </AnimatedSidebarContent>

            <AnimatedSidebarFooter>
              <div className="flex items-center gap-2 overflow-hidden rounded-xl p-1">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium text-foreground">
                  S
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] group-data-[state=collapsed]/sidebar:hidden">
                  User
                </span>
                <FooterSettings />
              </div>
            </AnimatedSidebarFooter>

            <AnimatedSidebarRail />
          </AnimatedSidebar>

          <AnimatedSidebarInset className="bg-background">
            <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
              <AnimatedSidebarTrigger className="text-muted-foreground hover:bg-muted hover:text-foreground">
                <PanelLeft aria-hidden="true" className="size-4" />
              </AnimatedSidebarTrigger>
              <div className="h-5 w-px bg-border" />
              <p className="text-sm font-medium">{active}</p>
            </header>

            <main className="flex-1 bg-background" />
          </AnimatedSidebarInset>
        </AnimatedSidebarProvider>
      </div>
    </ThemeProvider>
  )
}
