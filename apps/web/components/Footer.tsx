import SocialIconGrid from "./SocialIconGrid";
import FooterColumnComponent from "./FooterColumnComponent";
import { FooterColumnData, SocialMediaData } from "../lib/footerdata"; 

const currentYear = new Date().getFullYear();
  
export default function Footer (){
    return (
        <>
            <footer className="bg-bg">
                <div className="flex justify-center w-full gap-5">
                    {FooterColumnData.map((column,index)=>
                        <FooterColumnComponent title={column.title} content={column.content} key={column.title+index}></FooterColumnComponent>
                    )}
                    <SocialIconGrid Handles={SocialMediaData}></SocialIconGrid>
                </div>
                <hr className="my-6 h-[0.5px] border-white-500 border-opacity-40"/>
                <div className="flex justify-center">© {currentYear} Mclaren P1. All rights reserved.</div>
                {/* Spacer */}
                <div className="w-full h-15"></div>
            </footer>
        </>
    )
}