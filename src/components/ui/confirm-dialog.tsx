import type { VariantProps } from "class-variance-authority"

import { AlertDialog as AlertDialogPrimitive } from "radix-ui"
import * as React from "react"
import { buttonVariants } from "@/components/ui/button-variants"
import { cn } from "@/lib/utils"

function ConfirmDialog({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="confirm-dialog" {...props} />
}

function ConfirmDialogTrigger({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="confirm-dialog-trigger" {...props} />
}

function ConfirmDialogPortal({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="confirm-dialog-portal" {...props} />
}

function ConfirmDialogOverlay({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="confirm-dialog-overlay"
      className={cn(
        "oo-modal-backdrop fixed inset-0 z-[120] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  )
}

function ConfirmDialogContent({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <ConfirmDialogPortal>
      <ConfirmDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="confirm-dialog-content"
        className={cn(
          "oo-modal-surface fixed top-1/2 left-1/2 z-[121] grid w-[min(calc(100vw-2rem),28rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </ConfirmDialogPortal>
  )
}

function ConfirmDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="confirm-dialog-header" className={cn("grid gap-2", className)} {...props} />
}

function ConfirmDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="confirm-dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  )
}

function ConfirmDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="confirm-dialog-title"
      className={cn("oo-text-dialog-title", className)}
      {...props}
    />
  )
}

function ConfirmDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="confirm-dialog-description"
      className={cn("oo-text-body text-muted-foreground", className)}
      {...props}
    />
  )
}

function ConfirmDialogAction({
  className,
  variant = "destructive",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> & Pick<VariantProps<typeof buttonVariants>, "variant">) {
  return (
    <AlertDialogPrimitive.Action
      data-slot="confirm-dialog-action"
      className={cn(buttonVariants({ className, variant }))}
      {...props}
    />
  )
}

function ConfirmDialogCancel({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      data-slot="confirm-dialog-cancel"
      className={cn(buttonVariants({ className, variant: "outline" }))}
      {...props}
    />
  )
}

export {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
}
