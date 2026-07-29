import {NextRequest, NextResponse} from "next/server";
import prisma, {Prisma} from "@/lib/prisma";
import {HealthData} from "@/app/api/health-data/route";

export interface HealthDataPatchRequest {
    data?: Prisma.InputJsonValue
}

export interface HealthDataGetResponse {
    healthData: HealthData
}

export async function GET(
    req: NextRequest,
    {params}: { params: Promise<{ id: string }> }
) {
    const {id} = await params
    const healthData = await prisma.healthData.findUniqueOrThrow({where: {id}})
    return NextResponse.json({healthData})
}

export async function PATCH(
    req: NextRequest,
    {params}: { params: Promise<{ id: string }> }
) {
    const {id} = await params
    const body: HealthDataPatchRequest = await req.json()

    const healthData = await prisma.healthData.update({
        where: {id},
        data: body
    })
    return NextResponse.json({healthData})
}

export async function DELETE(
    req: NextRequest,
    {params}: { params: Promise<{ id: string }> }
) {
    const {id} = await params
    // Permanent sources (Personal Info, Personal Context) can never be deleted.
    const existing = await prisma.healthData.findUnique({where: {id}, select: {type: true}})
    if (existing && ['PERSONAL_INFO', 'PERSONAL_CONTEXT'].includes(existing.type)) {
        return NextResponse.json({error: 'This source is permanent and cannot be deleted'}, {status: 403})
    }
    await prisma.healthData.delete({where: {id}})
    return NextResponse.json({})
}
