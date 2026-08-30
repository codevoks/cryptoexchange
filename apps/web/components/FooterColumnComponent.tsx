import Link from "next/link";
import { FooterContent } from "@repo/types/footerTypes";
import { FooterColumn } from "@repo/types/footerTypes";
import { footerColumnTitleStyle,footerColumnBodyStyle } from "../styles/footerColumn/footerColumnStyle"

export default function FooterColumnComponent ({title, content}: FooterColumn) {
    return (
        <div className="">
            <div className={footerColumnTitleStyle}>
                {title}
            </div>
            {content.map((subtitles: FooterContent, index)=> (
                 <Link key={subtitles.label + index} href={subtitles.href} className={footerColumnBodyStyle}>{subtitles.label}</Link>
            )
        )}
        </div>
    )
}